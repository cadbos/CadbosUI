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

import type { D1Database } from '@cloudflare/workers-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeD1 } from './testing/d1-shim';
import { getExchangeRate } from './exchange-rate';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
	return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getExchangeRate', () => {
	it('parses the CoinGecko response shape', async () => {
		const db: D1Database = makeD1();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ bitcoin: { usd: 50_000 } }))
		);

		const rate = await getExchangeRate(db, 'coingecko', 1000);

		expect(rate).toEqual({ provider: 'coingecko', satsPerUsd: 2000, fetchedAt: 1000 });
	});

	it('parses the Kraken response shape', async () => {
		const db: D1Database = makeD1();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({
					error: [],
					result: { XXBTZUSD: { c: ['25000.00000', '0.001'] } }
				})
			)
		);

		const rate = await getExchangeRate(db, 'kraken', 1000);

		expect(rate).toEqual({ provider: 'kraken', satsPerUsd: 4000, fetchedAt: 1000 });
	});

	it('parses the Coinbase response shape', async () => {
		const db: D1Database = makeD1();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({ data: { amount: '100000.00', base: 'BTC', currency: 'USD' } })
			)
		);

		const rate = await getExchangeRate(db, 'coinbase', 1000);

		expect(rate).toEqual({ provider: 'coinbase', satsPerUsd: 1000, fetchedAt: 1000 });
	});

	it('throws when Kraken reports an error', async () => {
		const db: D1Database = makeD1();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ error: ['EQuery:Unknown asset pair'], result: {} }))
		);

		await expect(getExchangeRate(db, 'kraken', 1000)).rejects.toThrow(
			'Kraken rate fetch returned an error'
		);
	});

	it('throws on a non-ok upstream response', async () => {
		const db: D1Database = makeD1();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({}, false, 503))
		);

		await expect(getExchangeRate(db, 'coingecko', 1000)).rejects.toThrow(
			'CoinGecko rate fetch failed: 503'
		);
	});

	it('reuses a cached rate within the TTL without calling fetch again', async () => {
		const db: D1Database = makeD1();
		const fetchMock = vi.fn(async () => jsonResponse({ bitcoin: { usd: 50_000 } }));
		vi.stubGlobal('fetch', fetchMock);

		const first = await getExchangeRate(db, 'coingecko', 1000);
		const second = await getExchangeRate(db, 'coingecko', 1000 + 60_000);

		expect(second).toEqual(first);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('refetches once the cached rate has expired', async () => {
		const db: D1Database = makeD1();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ bitcoin: { usd: 50_000 } }))
			.mockResolvedValueOnce(jsonResponse({ bitcoin: { usd: 25_000 } }));
		vi.stubGlobal('fetch', fetchMock);

		const first = await getExchangeRate(db, 'coingecko', 1000);
		const second = await getExchangeRate(db, 'coingecko', 1000 + 90_001);

		expect(first.satsPerUsd).toBe(2000);
		expect(second.satsPerUsd).toBe(4000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('defaults to Kraken when no provider is given', async () => {
		const db: D1Database = makeD1();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				expect(url).toContain('kraken.com');
				return jsonResponse({ error: [], result: { XXBTZUSD: { c: ['50000.00000', '0.001'] } } });
			})
		);

		const rate = await getExchangeRate(db, undefined, 1000);

		expect(rate.provider).toBe('kraken');
	});
});
