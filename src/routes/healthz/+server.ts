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
import {
	healthSnapshotSchema,
	type HealthServiceStatus,
	type HealthSnapshot,
	type NostrHealth,
	type ServiceHealth
} from '$lib/api/contract';
import { NOSTR_PROFILE_BOOTSTRAP_RELAYS } from '$lib/nostr/connect';
import { getBucketByName, uploadsBucketName } from '$lib/server/media';
import { isS3BucketAvailable } from '$lib/server/s3';
import { getWalletBalance } from '$lib/server/wallet';

const DEFAULT_HEALTH_CACHE_TTL_SECONDS = 30;
const HEALTH_PROBE_TIMEOUT_MS = 10_000;
const COMFYUI_SYSTEM_STATS_URL = 'http://localhost:8188/system_stats';
const STATIC_ASSET_URL = 'https://assets.internal/favicon.svg';
const DEFAULT_CLOUDFLARE_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const DEFAULT_D1_DAILY_ROWS_READ_LIMIT = 5_000_000;
const DEFAULT_D1_DAILY_ROWS_WRITTEN_LIMIT = 100_000;
const D1_DAILY_USAGE_QUERY = `
	query D1DailyUsage($accountTag: string!, $date: Date!) {
		viewer {
			accounts(filter: { accountTag: $accountTag }) {
				d1AnalyticsAdaptiveGroups(
					limit: 1
					filter: { date_geq: $date, date_leq: $date }
				) {
					sum {
						rowsRead
						rowsWritten
					}
				}
			}
		}
	}
`;

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

interface D1QuotaConfig {
	accountId: string;
	apiToken: string;
	graphqlUrl: string;
	readLimit: number;
	writeLimit: number;
}

interface D1DailyUsage {
	rowsRead: number;
	rowsWritten: number;
}

class D1AnalyticsError extends Error {
	constructor(reason: 'http' | 'response') {
		super(reason);
		this.name = 'D1AnalyticsError';
	}
}

function positiveInteger(value: string | undefined): number | undefined {
	if (!value?.trim()) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function configuredLimit(value: string | undefined, defaultValue: number): number | undefined {
	return value === undefined ? defaultValue : positiveInteger(value);
}

function httpsUrl(value: string | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : undefined;
	} catch {
		return undefined;
	}
}

function d1QuotaConfig(env: App.Platform['env'] | undefined): D1QuotaConfig | undefined {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID?.trim();
	const apiToken = env?.CLOUDFLARE_ANALYTICS_API_TOKEN?.trim();
	const graphqlUrl = httpsUrl(env?.CLOUDFLARE_GRAPHQL_URL ?? DEFAULT_CLOUDFLARE_GRAPHQL_URL);
	const readLimit = configuredLimit(
		env?.D1_DAILY_ROWS_READ_LIMIT,
		DEFAULT_D1_DAILY_ROWS_READ_LIMIT
	);
	const writeLimit = configuredLimit(
		env?.D1_DAILY_ROWS_WRITTEN_LIMIT,
		DEFAULT_D1_DAILY_ROWS_WRITTEN_LIMIT
	);
	if (
		!accountId ||
		!apiToken ||
		!graphqlUrl ||
		readLimit === undefined ||
		writeLimit === undefined
	) {
		console.warn(JSON.stringify({ event: 'd1_quota_configuration_invalid' }));
		return undefined;
	}
	return { accountId, apiToken, graphqlUrl, readLimit, writeLimit };
}

function metric(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseD1DailyUsage(payload: unknown): D1DailyUsage | undefined {
	if (!isRecord(payload)) return undefined;
	if (Array.isArray(payload.errors) && payload.errors.length > 0) return undefined;
	const data = payload.data;
	if (!isRecord(data) || !isRecord(data.viewer) || !Array.isArray(data.viewer.accounts)) {
		return undefined;
	}
	if (data.viewer.accounts.length !== 1) return undefined;
	const account = data.viewer.accounts[0];
	if (!isRecord(account) || !Array.isArray(account.d1AnalyticsAdaptiveGroups)) return undefined;

	let rowsRead = 0;
	let rowsWritten = 0;
	for (const group of account.d1AnalyticsAdaptiveGroups) {
		if (!isRecord(group) || !isRecord(group.sum)) return undefined;
		const groupRowsRead = metric(group.sum.rowsRead);
		const groupRowsWritten = metric(group.sum.rowsWritten);
		if (groupRowsRead === undefined || groupRowsWritten === undefined) return undefined;
		rowsRead += groupRowsRead;
		rowsWritten += groupRowsWritten;
	}
	return { rowsRead, rowsWritten };
}

function logD1Error(event: 'd1_live_probe_failed' | 'd1_quota_check_failed', error: unknown): void {
	const errorType =
		error instanceof D1AnalyticsError
			? error.message
			: error instanceof Error
				? error.name
				: typeof error;
	console.error(JSON.stringify({ event, error: errorType }));
}

async function probeD1Quota(
	env: App.Platform['env'] | undefined,
	fetcher: typeof fetch
): Promise<HealthServiceStatus> {
	const config = d1QuotaConfig(env);
	if (!config) return 'unhealthy';

	try {
		const date = new Date().toISOString().slice(0, 10);
		const response = await fetcher(config.graphqlUrl, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${config.apiToken}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				query: D1_DAILY_USAGE_QUERY,
				variables: { accountTag: config.accountId, date }
			}),
			signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS)
		});
		if (!response.ok) throw new D1AnalyticsError('http');
		const usage = parseD1DailyUsage(await response.json());
		if (!usage) throw new D1AnalyticsError('response');
		const readLimitReached = usage.rowsRead >= config.readLimit;
		const writeLimitReached = usage.rowsWritten >= config.writeLimit;
		if (readLimitReached || writeLimitReached) {
			console.warn(
				JSON.stringify({ event: 'd1_quota_limit_reached', readLimitReached, writeLimitReached })
			);
			return 'unhealthy';
		}
		return 'healthy';
	} catch (error) {
		logD1Error('d1_quota_check_failed', error);
		return 'unhealthy';
	}
}

async function probeD1(
	env: App.Platform['env'] | undefined,
	fetcher: typeof fetch
): Promise<ServiceHealth> {
	const startedAt = performance.now();
	const quotaPromise = probeD1Quota(env, fetcher);
	let liveHealthy = false;
	try {
		liveHealthy =
			env?.DB !== undefined &&
			(await env.DB.prepare('SELECT 1 AS healthy').first<number>('healthy')) === 1;
	} catch (error) {
		logD1Error('d1_live_probe_failed', error);
	}
	const latencyMs = latencySince(startedAt);
	const quotaStatus = await quotaPromise;
	return {
		status: !liveHealthy || quotaStatus === 'unhealthy' ? 'unhealthy' : quotaStatus,
		latencyMs
	};
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
	const [archai, assets, comfyui, d1, nostr, s3] = await Promise.all([
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
		probeD1(env, fetcher),
		probeNostr(fetcher),
		probe(async () => {
			if (!env?.DB) return false;
			return isS3BucketAvailable(
				platform,
				await getBucketByName(env.DB, uploadsBucketName(platform))
			);
		})
	]);
	const services = { archai, assets, comfyui, d1, nostr, s3 };
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

async function cachedHealthResponse(cached: Response): Promise<Response | undefined> {
	const parsed = healthSnapshotSchema.safeParse(await cached.clone().json());
	if (!parsed.success) {
		console.warn(JSON.stringify({ event: 'health_cache_entry_invalid' }));
		return undefined;
	}
	const ageSeconds = Math.floor((Date.now() - Date.parse(parsed.data.timestamp)) / 1_000);
	const response = new Response(cached.body, cached);
	response.headers.set('age', String(Math.max(0, ageSeconds)));
	return response;
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
			const response = cached && (await cachedHealthResponse(cached));
			if (response) return response;
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
