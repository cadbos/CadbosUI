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
import { getLnbitsUsdPerBtc, type LnbitsConfig } from '$lib/server/lnbits';

const SATS_PER_BTC = 100_000_000;
const RATE_CACHE_MS = 90_000;

interface RateRow {
	usd_per_btc: number;
	expires_at: number;
}

export interface ExchangeRate {
	usdPerBtc: number;
	satsPerUsd: number;
}

function toRate(usdPerBtc: number): ExchangeRate {
	return { usdPerBtc, satsPerUsd: SATS_PER_BTC / usdPerBtc };
}

export async function getUsdExchangeRate(
	db: D1Database,
	config: LnbitsConfig,
	now: number
): Promise<ExchangeRate> {
	const cached = await db
		.prepare("SELECT usd_per_btc, expires_at FROM exchange_rate_cache WHERE currency = 'USD'")
		.first<RateRow>();
	if (cached && cached.expires_at > now) return toRate(cached.usd_per_btc);

	const usdPerBtc = await getLnbitsUsdPerBtc(config);
	await db
		.prepare(
			"INSERT INTO exchange_rate_cache (currency, usd_per_btc, fetched_at, expires_at) VALUES ('USD', ?, ?, ?) " +
				'ON CONFLICT (currency) DO UPDATE SET usd_per_btc = excluded.usd_per_btc, ' +
				'fetched_at = excluded.fetched_at, expires_at = excluded.expires_at'
		)
		.bind(usdPerBtc, now, now + RATE_CACHE_MS)
		.run();
	return toRate(usdPerBtc);
}
