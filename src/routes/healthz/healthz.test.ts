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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheStorage, D1Database, Fetcher } from '@cloudflare/workers-types';
import { TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';

const getWalletBalance = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({ isS3BucketAvailable: vi.fn() }));

vi.mock('$lib/server/wallet', () => ({ getWalletBalance }));
vi.mock('$lib/server/s3', () => ({ isS3BucketAvailable: storage.isS3BucketAvailable }));

import { GET } from './+server';

const NOW = new Date('2026-08-11T10:00:00.000Z');

type HealthGetEvent = Parameters<typeof GET>[0];

interface FakeCache {
	storage: CacheStorage;
	match: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	read(): Response | undefined;
}

interface HealthyPlatform {
	platform: App.Platform;
	assetsFetch: ReturnType<typeof vi.fn>;
	comfyuiFetch: ReturnType<typeof vi.fn>;
	dbFirst: ReturnType<typeof vi.fn>;
	s3BucketExists: ReturnType<typeof vi.fn>;
}

function fakeCache(initial?: Response): FakeCache {
	let value = initial?.clone();
	const match = vi.fn(async () => value?.clone());
	const put = vi.fn(async (_request: Request, response: Response) => {
		value = response.clone();
	});
	return {
		storage: { default: { match, put } } as unknown as CacheStorage,
		match,
		put,
		read: () => value?.clone()
	};
}

function service(status: 'healthy' | 'unhealthy' = 'healthy') {
	return { status, latencyMs: 1 };
}

function snapshot(status: 'healthy' | 'unhealthy' = 'healthy') {
	return {
		status,
		timestamp: NOW.toISOString(),
		services: {
			archai: service(),
			assets: service(),
			comfyui: service(),
			d1: service(),
			nostr: { ...service(), reachable: 4, total: 4 },
			s3: service(status === 'unhealthy' ? 'unhealthy' : 'healthy')
		}
	};
}

function cachedSnapshot(status: 'healthy' | 'unhealthy' = 'healthy'): Response {
	return Response.json(snapshot(status), {
		status: status === 'healthy' ? 200 : 503,
		headers: { 'cache-control': 'public, max-age=30' }
	});
}

function healthyPlatform(cache: CacheStorage, ttl?: string): HealthyPlatform {
	const assetsFetch = vi.fn(async () => new Response('<svg/>', { status: 200 }));
	const comfyuiFetch = vi.fn(async () => Response.json({ system: {} }));
	const dbFirst = vi.fn(async () => 1);
	const s3BucketExists = vi.fn(async () => true);
	storage.isS3BucketAvailable.mockImplementation(async () => s3BucketExists());
	const prepare = vi.fn((sql: string) =>
		sql.includes('FROM buckets')
			? { bind: () => ({ first: async () => TEST_S3_BUCKET }) }
			: { first: dbFirst }
	);
	return {
		platform: {
			caches: cache,
			env: {
				ARCHAI_API_KEY: 'archai-key',
				ARCHAI_API_URL: 'https://archai.example.test',
				ASSETS: { fetch: assetsFetch } as unknown as Fetcher,
				COMFYUI_BASE_URL: { fetch: comfyuiFetch } as unknown as Fetcher,
				DB: { prepare } as unknown as D1Database,
				...(ttl === undefined ? {} : { HEALTH_CACHE_TTL_SECONDS: ttl })
			}
		} as unknown as App.Platform,
		assetsFetch,
		comfyuiFetch,
		dbFirst,
		s3BucketExists
	};
}

function relayFetch(reachable = 4): typeof fetch {
	let requestCount = 0;
	return vi.fn(async () => {
		requestCount += 1;
		return requestCount <= reachable
			? Response.json({ name: 'relay' })
			: new Response(null, { status: 503 });
	}) as unknown as typeof fetch;
}

interface DelayedRelayResponse {
	delayMs: number;
	reachable: boolean;
}

function delayedRelayFetch(responses: readonly DelayedRelayResponse[]): typeof fetch {
	let requestCount = 0;
	return vi.fn(() => {
		const response = responses[requestCount];
		requestCount += 1;
		if (!response) throw new Error('Missing delayed relay response');
		return new Promise<Response>((resolve) => {
			setTimeout(() => {
				resolve(
					response.reachable
						? Response.json({ name: 'relay' })
						: new Response(null, { status: 503 })
				);
			}, response.delayMs);
		});
	}) as unknown as typeof fetch;
}

function callGet(
	platform: App.Platform,
	fetcher: typeof fetch,
	url = 'https://cadbos.example/healthz'
): ReturnType<typeof GET> {
	return GET({ request: new Request(url), platform, fetch: fetcher } as HealthGetEvent);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	getWalletBalance.mockResolvedValue(100);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe('GET /healthz', () => {
	it('returns a cache hit without probing services', async () => {
		const cache = fakeCache(cachedSnapshot());
		const healthy = healthyPlatform(cache.storage);
		const fetcher = relayFetch();

		const response = await callGet(healthy.platform, fetcher);

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('public, max-age=30');
		expect(await response.json()).toEqual(snapshot());
		expect(cache.match).toHaveBeenCalledOnce();
		expect(cache.put).not.toHaveBeenCalled();
		expect(getWalletBalance).not.toHaveBeenCalled();
		expect(healthy.assetsFetch).not.toHaveBeenCalled();
		expect(healthy.comfyuiFetch).not.toHaveBeenCalled();
		expect(healthy.dbFirst).not.toHaveBeenCalled();
		expect(healthy.s3BucketExists).not.toHaveBeenCalled();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('checks every service and caches a healthy response on a miss', async () => {
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);
		const fetcher = relayFetch();

		const response = await callGet(
			healthy.platform,
			fetcher,
			'https://cadbos.example/healthz?cache-buster=1'
		);
		const stored = cache.read();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('public, max-age=30');
		expect(await response.json()).toMatchObject({
			status: 'healthy',
			timestamp: NOW.toISOString(),
			services: {
				archai: { status: 'healthy', latencyMs: expect.any(Number) },
				assets: { status: 'healthy', latencyMs: expect.any(Number) },
				comfyui: { status: 'healthy', latencyMs: expect.any(Number) },
				d1: { status: 'healthy', latencyMs: expect.any(Number) },
				nostr: {
					status: 'healthy',
					latencyMs: expect.any(Number),
					reachable: 4,
					total: 4
				},
				s3: { status: 'healthy', latencyMs: expect.any(Number) }
			}
		});
		expect(cache.put).toHaveBeenCalledOnce();
		expect((cache.put.mock.calls[0][0] as Request).url).toBe('https://cadbos.example/healthz');
		expect(stored?.headers.get('cache-control')).toBe('public, max-age=30');
		expect(await stored?.json()).toMatchObject({ status: 'healthy' });
		expect(getWalletBalance).toHaveBeenCalledWith(healthy.platform);
		expect(healthy.dbFirst).toHaveBeenCalledWith('healthy');
		expect(healthy.s3BucketExists).toHaveBeenCalledOnce();
		expect(healthy.assetsFetch.mock.calls[0][0].url).toBe('https://assets.internal/favicon.svg');
		expect(healthy.comfyuiFetch.mock.calls[0][0].url).toBe('http://localhost:8188/system_stats');
		expect(fetcher).toHaveBeenCalledTimes(4);
	});

	it.each(['archai', 'assets', 'comfyui', 'd1', 'nostr', 's3'] as const)(
		'caches an unhealthy response when %s fails',
		async (failedService) => {
			const cache = fakeCache();
			const healthy = healthyPlatform(cache.storage);
			let fetcher = relayFetch();
			switch (failedService) {
				case 'archai':
					getWalletBalance.mockRejectedValue(new Error('archAI unavailable'));
					break;
				case 'assets':
					healthy.assetsFetch.mockRejectedValue(new Error('Assets unavailable'));
					break;
				case 'comfyui':
					healthy.comfyuiFetch.mockRejectedValue(new Error('ComfyUI unavailable'));
					break;
				case 'd1':
					healthy.dbFirst.mockRejectedValue(new Error('D1 unavailable'));
					break;
				case 'nostr':
					fetcher = relayFetch(0);
					break;
				case 's3':
					healthy.s3BucketExists.mockRejectedValue(new Error('S3 unavailable'));
					break;
			}

			const response = await callGet(healthy.platform, fetcher);
			const stored = cache.read();

			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({
				status: 'unhealthy',
				services: { [failedService]: { status: 'unhealthy' } }
			});
			expect(stored?.status).toBe(503);
			expect(await stored?.json()).toMatchObject({
				status: 'unhealthy',
				services: { [failedService]: { status: 'unhealthy' } }
			});
		}
	);

	it('keeps Nostr healthy while at least one configured relay responds', async () => {
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);

		const response = await callGet(healthy.platform, relayFetch(1));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			status: 'healthy',
			services: { nostr: { status: 'healthy', reachable: 1, total: 4 } }
		});
	});

	it('reports the median latency of reachable Nostr relays', async () => {
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);
		const responsePromise = callGet(
			healthy.platform,
			delayedRelayFetch([
				{ delayMs: 20, reachable: true },
				{ delayMs: 40, reachable: true },
				{ delayMs: 80, reachable: true },
				{ delayMs: 10_000, reachable: false }
			])
		);

		await vi.advanceTimersByTimeAsync(10_000);
		const response = await responsePromise;

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			services: { nostr: { status: 'healthy', latencyMs: 40, reachable: 3, total: 4 } }
		});
	});

	it('averages the two central reachable relay latencies', async () => {
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);
		const responsePromise = callGet(
			healthy.platform,
			delayedRelayFetch([
				{ delayMs: 20, reachable: true },
				{ delayMs: 81, reachable: true },
				{ delayMs: 100, reachable: false },
				{ delayMs: 120, reachable: false }
			])
		);

		await vi.advanceTimersByTimeAsync(120);
		const response = await responsePromise;

		expect(await response.json()).toMatchObject({
			services: { nostr: { status: 'healthy', latencyMs: 51, reachable: 2, total: 4 } }
		});
	});

	it('reports the full probe duration when every Nostr relay fails', async () => {
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);
		const responsePromise = callGet(
			healthy.platform,
			delayedRelayFetch([
				{ delayMs: 20, reachable: false },
				{ delayMs: 40, reachable: false },
				{ delayMs: 80, reachable: false },
				{ delayMs: 10_000, reachable: false }
			])
		);

		await vi.advanceTimersByTimeAsync(10_000);
		const response = await responsePromise;

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			services: { nostr: { status: 'unhealthy', latencyMs: 10_000, reachable: 0, total: 4 } }
		});
	});

	it('uses the configured cache lifetime', async () => {
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage, '75');

		const response = await callGet(healthy.platform, relayFetch());

		expect(response.headers.get('cache-control')).toBe('public, max-age=75');
		expect(cache.read()?.headers.get('cache-control')).toBe('public, max-age=75');
	});

	it.each(['0', '-1', '1.5', 'invalid'])(
		'uses the default cache lifetime when %s is configured',
		async (configured) => {
			const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const cache = fakeCache();
			const healthy = healthyPlatform(cache.storage, configured);

			const response = await callGet(healthy.platform, relayFetch());

			expect(response.headers.get('cache-control')).toBe('public, max-age=30');
			expect(warning).toHaveBeenCalledWith(JSON.stringify({ event: 'health_cache_ttl_invalid' }));
		}
	);

	it('performs fresh checks when the cache cannot be read', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cache = fakeCache();
		cache.match.mockRejectedValue(new Error('Cache unavailable'));
		const healthy = healthyPlatform(cache.storage);

		const response = await callGet(healthy.platform, relayFetch());

		expect(response.status).toBe(200);
		expect(cache.put).toHaveBeenCalledOnce();
		expect(getWalletBalance).toHaveBeenCalledOnce();
		expect(errorLog).toHaveBeenCalledWith('Health cache read failed:', 'Error');
	});

	it('returns fresh health when the response cannot be cached', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cache = fakeCache();
		cache.put.mockRejectedValue(new Error('Cache unavailable'));
		const healthy = healthyPlatform(cache.storage);

		const response = await callGet(healthy.platform, relayFetch());

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ status: 'healthy' });
		expect(errorLog).toHaveBeenCalledWith('Health cache write failed:', 'Error');
	});
});
