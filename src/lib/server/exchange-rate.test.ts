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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeD1 } from '$lib/server/testing/d1-shim';

const lnbits = vi.hoisted(() => ({ getLnbitsUsdPerBtc: vi.fn() }));
vi.mock('$lib/server/lnbits', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/lnbits')>()),
	getLnbitsUsdPerBtc: lnbits.getLnbitsUsdPerBtc
}));

const { getUsdExchangeRate } = await import('./exchange-rate');
const config = { baseUrl: 'https://lnbits.example.test', invoiceKey: 'invoice-key' };
const now = 1_800_000_000_000;

beforeEach(() => {
	lnbits.getLnbitsUsdPerBtc.mockReset();
});

describe('LNbits exchange-rate cache', () => {
	it('uses an unexpired cached response without contacting LNbits', async () => {
		const db = makeD1();
		db.prepare(
			"INSERT INTO exchange_rate_cache (currency, usd_per_btc, fetched_at, expires_at) VALUES ('USD', ?, ?, ?)"
		)
			.bind(100_000, now - 1_000, now + 1_000)
			.run();

		await expect(getUsdExchangeRate(db, config, now)).resolves.toEqual({
			usdPerBtc: 100_000,
			satsPerUsd: 1_000
		});
		expect(lnbits.getLnbitsUsdPerBtc).not.toHaveBeenCalled();
	});

	it('refreshes an expired cache entry and stores the new expiry', async () => {
		const db = makeD1();
		db.prepare(
			"INSERT INTO exchange_rate_cache (currency, usd_per_btc, fetched_at, expires_at) VALUES ('USD', ?, ?, ?)"
		)
			.bind(50_000, now - 100_000, now - 1)
			.run();
		lnbits.getLnbitsUsdPerBtc.mockResolvedValueOnce(200_000);

		await expect(getUsdExchangeRate(db, config, now)).resolves.toEqual({
			usdPerBtc: 200_000,
			satsPerUsd: 500
		});
		expect(
			await db
				.prepare(
					"SELECT usd_per_btc, fetched_at, expires_at FROM exchange_rate_cache WHERE currency = 'USD'"
				)
				.first()
		).toEqual({ usd_per_btc: 200_000, fetched_at: now, expires_at: now + 90_000 });
	});

	it('retries LNbits after a failed refresh without caching the failure', async () => {
		const db = makeD1();
		lnbits.getLnbitsUsdPerBtc
			.mockRejectedValueOnce(new Error('timeout'))
			.mockResolvedValueOnce(100_000);

		await expect(getUsdExchangeRate(db, config, now)).rejects.toThrow('timeout');
		await expect(getUsdExchangeRate(db, config, now + 1)).resolves.toEqual({
			usdPerBtc: 100_000,
			satsPerUsd: 1_000
		});
		expect(lnbits.getLnbitsUsdPerBtc).toHaveBeenCalledTimes(2);
	});
});
