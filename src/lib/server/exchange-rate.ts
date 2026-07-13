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

// BTC/USD rate lookup for pricing Lightning deposits (docs/payments-lightning-sats.md
// §4). Three interchangeable sources so the operator isn't tied to one API's
// uptime; Kraken is the default because its rate also anchors future USD
// settlement (converting collected sats to pay AI-provider traffic), where
// Kraken's own order book is the actual place that conversion would happen.

import type { D1Database } from '@cloudflare/workers-types';

export type ExchangeRateProvider = 'coingecko' | 'kraken' | 'coinbase';

export const DEFAULT_EXCHANGE_RATE_PROVIDER: ExchangeRateProvider = 'kraken';

const SATS_PER_BTC = 100_000_000;
const CACHE_TTL_MS = 90_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface ExchangeRate {
	provider: ExchangeRateProvider;
	satsPerUsd: number;
	fetchedAt: number;
}

interface CacheRow {
	sats_per_usd: number;
	fetched_at: number;
	expires_at: number;
}

async function fetchUsdPerBtc(provider: ExchangeRateProvider): Promise<number> {
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	switch (provider) {
		case 'coingecko': {
			const response = await fetch(
				'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
				{ signal }
			);
			if (!response.ok) throw new Error(`CoinGecko rate fetch failed: ${response.status}`);
			const body = (await response.json()) as { bitcoin?: { usd?: number } };
			const usd = body.bitcoin?.usd;
			if (typeof usd !== 'number' || !(usd > 0)) {
				throw new Error('CoinGecko rate fetch returned an unexpected response shape');
			}
			return usd;
		}
		case 'kraken': {
			const response = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', {
				signal
			});
			if (!response.ok) throw new Error(`Kraken rate fetch failed: ${response.status}`);
			const body = (await response.json()) as {
				error?: string[];
				// Kraken keys the BTC/USD pair as XXBTZUSD, not XBTUSD; `c` is
				// [last trade price, lot volume] as strings.
				result?: { XXBTZUSD?: { c?: [string, string] } };
			};
			if (body.error && body.error.length > 0) {
				throw new Error(`Kraken rate fetch returned an error: ${body.error.join(', ')}`);
			}
			const usd = Number(body.result?.XXBTZUSD?.c?.[0]);
			if (!(usd > 0)) {
				throw new Error('Kraken rate fetch returned an unexpected response shape');
			}
			return usd;
		}
		case 'coinbase': {
			const response = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { signal });
			if (!response.ok) throw new Error(`Coinbase rate fetch failed: ${response.status}`);
			const body = (await response.json()) as { data?: { amount?: string } };
			const usd = Number(body.data?.amount);
			if (!(usd > 0)) {
				throw new Error('Coinbase rate fetch returned an unexpected response shape');
			}
			return usd;
		}
	}
}

function toExchangeRate(provider: ExchangeRateProvider, row: CacheRow): ExchangeRate {
	return { provider, satsPerUsd: row.sats_per_usd, fetchedAt: row.fetched_at };
}

// Returns a sats-per-usd rate for `provider`, reusing a cache entry younger
// than CACHE_TTL_MS so a burst of invoice creations doesn't hammer the
// upstream API. This does NOT itself fix a rate for a deposit's lifetime —
// callers that need that (payments.ts's createDeposit) must call this once
// and persist the returned satsPerUsd on the deposit row; a later call here
// can return a different rate once the cache entry expires.
export async function getExchangeRate(
	db: D1Database,
	provider: ExchangeRateProvider = DEFAULT_EXCHANGE_RATE_PROVIDER,
	now: number = Date.now()
): Promise<ExchangeRate> {
	const cached = await db
		.prepare(
			'SELECT sats_per_usd, fetched_at, expires_at FROM exchange_rate_cache WHERE provider = ?'
		)
		.bind(provider)
		.first<CacheRow>();
	if (cached && cached.expires_at > now) return toExchangeRate(provider, cached);

	const usdPerBtc = await fetchUsdPerBtc(provider);
	const row: CacheRow = {
		sats_per_usd: SATS_PER_BTC / usdPerBtc,
		fetched_at: now,
		expires_at: now + CACHE_TTL_MS
	};
	await db
		.prepare(
			'INSERT INTO exchange_rate_cache (provider, sats_per_usd, fetched_at, expires_at) ' +
				'VALUES (?, ?, ?, ?) ' +
				'ON CONFLICT (provider) DO UPDATE SET ' +
				'sats_per_usd = excluded.sats_per_usd, fetched_at = excluded.fetched_at, ' +
				'expires_at = excluded.expires_at'
		)
		.bind(provider, row.sats_per_usd, row.fetched_at, row.expires_at)
		.run();
	return toExchangeRate(provider, row);
}
