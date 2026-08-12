/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { HealthSnapshot, NostrHealth, ServiceHealth } from '$lib/api/contract';
import { NOSTR_PROFILE_BOOTSTRAP_RELAYS } from '$lib/nostr/connect';
import { getWalletBalance } from '$lib/server/wallet';

const DEFAULT_HEALTH_CACHE_TTL_SECONDS = 30;
const HEALTH_PROBE_TIMEOUT_MS = 10_000;
const COMFYUI_SYSTEM_STATS_URL = 'http://localhost:8188/system_stats';
const STATIC_ASSET_URL = 'https://assets.internal/favicon.svg';

interface HealthCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

function latencySince(startedAt: number): number {
	return Math.max(0, Math.round(performance.now() - startedAt));
}

async function probe(check: () => Promise<boolean>): Promise<ServiceHealth> {
	const startedAt = performance.now();
	try {
		return {
			status: (await check()) ? 'healthy' : 'unhealthy',
			latencyMs: latencySince(startedAt)
		};
	} catch {
		return { status: 'unhealthy', latencyMs: latencySince(startedAt) };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function probeNostr(fetcher: typeof fetch): Promise<NostrHealth> {
	const startedAt = performance.now();
	const probes = await Promise.all(
		NOSTR_PROFILE_BOOTSTRAP_RELAYS.map(async (relay) => {
			const relayStartedAt = performance.now();
			try {
				const url = new URL(relay);
				url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
				const response = await fetcher(url, {
					headers: { accept: 'application/nostr+json' },
					signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS)
				});
				return {
					reachable: response.ok && isRecord(await response.json()),
					latencyMs: latencySince(relayStartedAt)
				};
			} catch {
				return { reachable: false, latencyMs: latencySince(relayStartedAt) };
			}
		})
	);
	const successfulLatencies = probes
		.filter(({ reachable }) => reachable)
		.map(({ latencyMs }) => latencyMs)
		.sort((left, right) => left - right);
	const reachable = successfulLatencies.length;
	const midpoint = Math.floor(reachable / 2);
	const latencyMs =
		reachable === 0
			? latencySince(startedAt)
			: reachable % 2 === 1
				? successfulLatencies[midpoint]
				: Math.round((successfulLatencies[midpoint - 1] + successfulLatencies[midpoint]) / 2);
	return {
		status: reachable > 0 ? 'healthy' : 'unhealthy',
		latencyMs,
		reachable,
		total: probes.length
	};
}

async function collectHealthSnapshot(
	platform: App.Platform | undefined,
	fetcher: typeof fetch
): Promise<HealthSnapshot> {
	const env = platform?.env;
	const [archai, assets, comfyui, d1, nostr, r2] = await Promise.all([
		probe(async () => {
			if (!env?.ARCHAI_API_KEY || !env.ARCHAI_API_URL) return false;
			await getWalletBalance(platform);
			return true;
		}),
		probe(async () => {
			if (!env?.ASSETS) return false;
			const fetchAsset = env.ASSETS.fetch.bind(env.ASSETS) as unknown as typeof fetch;
			const response = await fetchAsset(
				new Request(STATIC_ASSET_URL, {
					signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS)
				})
			);
			return response.ok;
		}),
		probe(async () => {
			if (!env?.COMFYUI_BASE_URL) return false;
			const fetchComfyUi = env.COMFYUI_BASE_URL.fetch.bind(
				env.COMFYUI_BASE_URL
			) as unknown as typeof fetch;
			const response = await fetchComfyUi(
				new Request(COMFYUI_SYSTEM_STATS_URL, {
					signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS)
				})
			);
			return response.ok && isRecord(await response.json());
		}),
		probe(async () => {
			if (!env?.DB) return false;
			return (await env.DB.prepare('SELECT 1 AS healthy').first<number>('healthy')) === 1;
		}),
		probeNostr(fetcher),
		probe(async () => {
			if (!env?.UPLOADS_BUCKET) return false;
			await env.UPLOADS_BUCKET.list({ limit: 1 });
			return true;
		})
	]);
	const services = { archai, assets, comfyui, d1, nostr, r2 };
	return {
		status: Object.values(services).every((service) => service.status === 'healthy')
			? 'healthy'
			: 'unhealthy',
		timestamp: new Date().toISOString(),
		services
	};
}

function cacheTtlSeconds(platform: App.Platform | undefined): number {
	const configured = platform?.env?.HEALTH_CACHE_TTL_SECONDS?.trim();
	if (!configured) return DEFAULT_HEALTH_CACHE_TTL_SECONDS;
	const value = Number(configured);
	if (!Number.isSafeInteger(value) || value <= 0) {
		console.warn(JSON.stringify({ event: 'health_cache_ttl_invalid' }));
		return DEFAULT_HEALTH_CACHE_TTL_SECONDS;
	}
	return value;
}

function cacheKey(request: Request): Request {
	const url = new URL(request.url);
	url.pathname = '/healthz';
	url.search = '';
	url.hash = '';
	return new Request(url);
}

function healthResponse(snapshot: HealthSnapshot, ttlSeconds: number): Response {
	return json(snapshot, {
		status: snapshot.status === 'healthy' ? 200 : 503,
		headers: { 'cache-control': `public, max-age=${ttlSeconds}` }
	});
}

function logCacheError(operation: 'read' | 'write', error: unknown): void {
	console.error(
		`Health cache ${operation} failed:`,
		error instanceof Error ? error.name : typeof error
	);
}

export const GET: RequestHandler = async ({ request, platform, fetch }) => {
	const ttlSeconds = cacheTtlSeconds(platform);
	const key = cacheKey(request);
	const cache = platform?.caches.default as unknown as HealthCache | undefined;

	if (cache) {
		try {
			const cached = await cache.match(key);
			if (cached) return cached;
		} catch (error) {
			logCacheError('read', error);
		}
	}

	const response = healthResponse(await collectHealthSnapshot(platform, fetch), ttlSeconds);
	if (cache) {
		try {
			await cache.put(key, response.clone());
		} catch (error) {
			logCacheError('write', error);
		}
	}
	return response;
};
