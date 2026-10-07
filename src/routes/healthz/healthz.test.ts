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
import type { HealthSnapshot } from '$lib/api/contract';
import { TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';

const getWalletBalance = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({ isS3BucketAvailable: vi.fn() }));

vi.mock('$lib/server/wallet', () => ({ getWalletBalance }));
vi.mock('$lib/server/s3', () => ({ isS3BucketAvailable: storage.isS3BucketAvailable }));

import { GET } from './+server';

const NOW = new Date('2026-08-11T10:00:00.000Z');
const CLOUDFLARE_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const D1_READ_LIMIT = 5_000_000;
const D1_WRITE_LIMIT = 100_000;

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

function service(status: HealthSnapshot['status'] = 'healthy') {
	return { status, latencyMs: 1 };
}

function snapshot(status: HealthSnapshot['status'] = 'healthy'): HealthSnapshot {
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
				CLOUDFLARE_ACCOUNT_ID: 'account-id',
				CLOUDFLARE_ANALYTICS_API_TOKEN: 'analytics-token',
				CLOUDFLARE_GRAPHQL_URL,
				D1_DAILY_ROWS_READ_LIMIT: String(D1_READ_LIMIT),
				D1_DAILY_ROWS_WRITTEN_LIMIT: String(D1_WRITE_LIMIT),
				...(ttl === undefined ? {} : { HEALTH_CACHE_TTL_SECONDS: ttl })
			}
		} as unknown as App.Platform,
		assetsFetch,
		comfyuiFetch,
		dbFirst,
		s3BucketExists
	};
}

function analyticsPayload(rowsRead = 1_000, rowsWritten = 100): unknown {
	return {
		data: {
			viewer: {
				accounts: [
					{
						d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead, rowsWritten } }]
					}
				]
			}
		}
	};
}

interface AnalyticsResponse {
	body?: unknown;
	error?: unknown;
	status?: number;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
	return input instanceof Request ? input.url : String(input);
}

function relayFetch(
	reachable = 4,
	analytics: AnalyticsResponse = { body: analyticsPayload() }
): typeof fetch {
	let requestCount = 0;
	return vi.fn(async (input) => {
		if (requestUrl(input) === CLOUDFLARE_GRAPHQL_URL) {
			if (analytics.error !== undefined) throw analytics.error;
			return Response.json(analytics.body ?? analyticsPayload(), {
				status: analytics.status ?? 200
			});
		}
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
	return vi.fn((input) => {
		if (requestUrl(input) === CLOUDFLARE_GRAPHQL_URL) {
			return Promise.resolve(Response.json(analyticsPayload()));
		}
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
		expect(response.headers.get('age')).toBe('0');
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

	it('reports how long a cache hit has been stored', async () => {
		const cache = fakeCache(cachedSnapshot('unhealthy'));
		const healthy = healthyPlatform(cache.storage);
		vi.setSystemTime(NOW.getTime() + 25_900);

		const response = await callGet(healthy.platform, relayFetch());

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('public, max-age=30');
		expect(response.headers.get('age')).toBe('25');
		expect(await response.json()).toEqual(snapshot('unhealthy'));
	});

	it('performs fresh checks when the cached snapshot is invalid', async () => {
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const cache = fakeCache(
			Response.json(
				{ status: 'healthy', timestamp: NOW.toISOString() },
				{ headers: { 'cache-control': 'public, max-age=30' } }
			)
		);
		const healthy = healthyPlatform(cache.storage);

		const response = await callGet(healthy.platform, relayFetch());

		expect(response.status).toBe(200);
		expect(response.headers.get('age')).toBeNull();
		expect(await response.json()).toMatchObject({ status: 'healthy' });
		expect(getWalletBalance).toHaveBeenCalledOnce();
		expect(cache.put).toHaveBeenCalledOnce();
		expect(await cache.read()?.json()).toMatchObject({ status: 'healthy' });
		expect(warning).toHaveBeenCalledWith(JSON.stringify({ event: 'health_cache_entry_invalid' }));
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
		expect(fetcher).toHaveBeenCalledTimes(5);
	});

	it.each([
		['read', D1_READ_LIMIT, 100],
		['write', 1_000, D1_WRITE_LIMIT]
	] as const)(
		'marks D1 unhealthy when the daily %s limit is reached',
		async (_, rowsRead, rowsWritten) => {
			const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const cache = fakeCache();
			const healthy = healthyPlatform(cache.storage);

			const response = await callGet(
				healthy.platform,
				relayFetch(4, { body: analyticsPayload(rowsRead, rowsWritten) })
			);

			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({
				status: 'unhealthy',
				services: { d1: { status: 'unhealthy' } }
			});
			expect(warning).toHaveBeenCalledWith(
				expect.stringContaining('"event":"d1_quota_limit_reached"')
			);
		}
	);

	it.each([
		['read', D1_READ_LIMIT, 100],
		['write', 1_000, D1_WRITE_LIMIT]
	] as const)(
		'applies the default %s quota limit when its variable is unset',
		async (_, rowsRead, rowsWritten) => {
			const cache = fakeCache();
			const healthy = healthyPlatform(cache.storage);
			delete healthy.platform.env.D1_DAILY_ROWS_READ_LIMIT;
			delete healthy.platform.env.D1_DAILY_ROWS_WRITTEN_LIMIT;

			const response = await callGet(
				healthy.platform,
				relayFetch(4, { body: analyticsPayload(rowsRead, rowsWritten) })
			);

			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({
				status: 'unhealthy',
				services: { d1: { status: 'unhealthy' } }
			});
		}
	);

	it('queries account-wide D1 usage for the current UTC date with the analytics token', async () => {
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);
		delete healthy.platform.env.CLOUDFLARE_GRAPHQL_URL;
		delete healthy.platform.env.D1_DAILY_ROWS_READ_LIMIT;
		delete healthy.platform.env.D1_DAILY_ROWS_WRITTEN_LIMIT;
		const fetcher = relayFetch();

		await callGet(healthy.platform, fetcher);

		const analyticsCall = vi
			.mocked(fetcher)
			.mock.calls.find(([input]) => requestUrl(input) === CLOUDFLARE_GRAPHQL_URL);
		expect(analyticsCall).toBeDefined();
		const init = analyticsCall?.[1];
		expect(init?.method).toBe('POST');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer analytics-token');
		const body = JSON.parse(String(init?.body)) as {
			query: string;
			variables: { accountTag: string; date: string };
		};
		expect(body.variables).toEqual({ accountTag: 'account-id', date: '2026-08-11' });
		expect(body.query).not.toContain('databaseId');
		expect(body.query).toContain('rowsRead');
		expect(body.query).toContain('rowsWritten');
	});

	it('treats an empty analytics group as zero usage', async () => {
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);
		const body = analyticsPayload() as {
			data: { viewer: { accounts: Array<{ d1AnalyticsAdaptiveGroups: unknown[] }> } };
		};
		body.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups = [];

		const response = await callGet(healthy.platform, relayFetch(4, { body }));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			status: 'healthy',
			services: { d1: { status: 'healthy' } }
		});
	});

	it.each([
		['HTTP failure', { status: 503 }],
		['request timeout', { error: new DOMException('timed out', 'TimeoutError') }],
		['GraphQL error', { body: { errors: [{ message: 'unauthorized' }] } }],
		['malformed response', { body: { data: { viewer: {} } } }],
		['invalid metrics', { body: analyticsPayload(-1, 100) }]
	] as const)('marks D1 unhealthy when analytics has an %s', async (_, analytics) => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);

		const response = await callGet(healthy.platform, relayFetch(4, analytics));

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			status: 'unhealthy',
			services: { d1: { status: 'unhealthy', latencyMs: expect.any(Number) } }
		});
		expect(errorLog).toHaveBeenCalledWith(
			expect.stringContaining('"event":"d1_quota_check_failed"')
		);
		expect(errorLog).not.toHaveBeenCalledWith(expect.stringContaining('analytics-token'));
	});

	it('marks D1 unhealthy when quota configuration is missing', async () => {
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);
		delete healthy.platform.env.CLOUDFLARE_ANALYTICS_API_TOKEN;
		const fetcher = relayFetch();

		const response = await callGet(healthy.platform, fetcher);

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			status: 'unhealthy',
			services: { d1: { status: 'unhealthy' } }
		});
		expect(fetcher).toHaveBeenCalledTimes(4);
		expect(warning).toHaveBeenCalledWith(
			JSON.stringify({ event: 'd1_quota_configuration_invalid' })
		);
	});

	it.each(['0', '-1', '1.5', 'invalid'])(
		'marks D1 unhealthy when its read quota is configured as %s',
		async (configured) => {
			const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const cache = fakeCache();
			const healthy = healthyPlatform(cache.storage);
			healthy.platform.env.D1_DAILY_ROWS_READ_LIMIT = configured;

			const response = await callGet(healthy.platform, relayFetch());

			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({
				status: 'unhealthy',
				services: { d1: { status: 'unhealthy' } }
			});
			expect(warning).toHaveBeenCalledWith(
				JSON.stringify({ event: 'd1_quota_configuration_invalid' })
			);
		}
	);

	it.each(['', 'http://api.cloudflare.test/graphql', 'not-a-url'])(
		'marks D1 unhealthy when the GraphQL URL is configured as %s',
		async (configured) => {
			const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const cache = fakeCache();
			const healthy = healthyPlatform(cache.storage);
			healthy.platform.env.CLOUDFLARE_GRAPHQL_URL = configured;

			const response = await callGet(healthy.platform, relayFetch());

			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({
				status: 'unhealthy',
				services: { d1: { status: 'unhealthy' } }
			});
			expect(warning).toHaveBeenCalledWith(
				JSON.stringify({ event: 'd1_quota_configuration_invalid' })
			);
		}
	);

	it('keeps D1 unhealthy when its live probe and quota verification both fail', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cache = fakeCache();
		const healthy = healthyPlatform(cache.storage);
		healthy.dbFirst.mockRejectedValue(new Error('D1 unavailable'));

		const response = await callGet(
			healthy.platform,
			relayFetch(4, { body: { errors: [{ message: 'unavailable' }] } })
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			status: 'unhealthy',
			services: { d1: { status: 'unhealthy' } }
		});
		expect(errorLog).toHaveBeenCalledTimes(2);
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
