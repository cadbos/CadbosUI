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
import { getLnbitsSatsPerUsd, type LnbitsConfig } from '$lib/server/lnbits';

const RATE_CACHE_MS = 90_000;

interface RateRow {
	sats_per_usd: number;
	expires_at: number;
}

export interface ExchangeRate {
	satsPerUsd: number;
}

export async function getUsdExchangeRate(
	db: D1Database,
	config: LnbitsConfig,
	now: number
): Promise<ExchangeRate> {
	const cached = await db
		.prepare("SELECT sats_per_usd, expires_at FROM exchange_rate_cache WHERE currency = 'USD'")
		.first<RateRow>();
	if (cached && cached.expires_at > now) return { satsPerUsd: cached.sats_per_usd };

	const satsPerUsd = await getLnbitsSatsPerUsd(config);
	await db
		.prepare(
			"INSERT INTO exchange_rate_cache (currency, sats_per_usd, fetched_at, expires_at) VALUES ('USD', ?, ?, ?) " +
				'ON CONFLICT (currency) DO UPDATE SET sats_per_usd = excluded.sats_per_usd, ' +
				'fetched_at = excluded.fetched_at, expires_at = excluded.expires_at'
		)
		.bind(satsPerUsd, now, now + RATE_CACHE_MS)
		.run();
	return { satsPerUsd };
}
