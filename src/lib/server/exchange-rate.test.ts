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

import { describe, expect, it, vi } from 'vitest';
import { getUsdRubRate } from './exchange-rate';

function cbrResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const validBody = {
	Date: '2026-08-22T11:30:00+03:00',
	Valute: { USD: { Value: 82.9211, Nominal: 1 } }
};

describe('getUsdRubRate', () => {
	it('returns the RUB-per-USD rate normalized to an ISO instant', async () => {
		const fetcher = vi.fn(async () => cbrResponse(validBody));

		const rate = await getUsdRubRate(fetcher as unknown as typeof fetch);

		expect(rate).toEqual({ rubPerUsd: 82.9211, asOf: '2026-08-22T08:30:00.000Z' });
		expect(fetcher).toHaveBeenCalledWith(
			'https://www.cbr-xml-daily.ru/daily_json.js',
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
	});

	it('divides by Nominal for currencies quoted per multiple units', async () => {
		const fetcher = vi.fn(async () =>
			cbrResponse({
				Date: validBody.Date,
				Valute: { USD: { Value: 200, Nominal: 2 } }
			})
		);

		const rate = await getUsdRubRate(fetcher as unknown as typeof fetch);

		expect(rate.rubPerUsd).toBe(100);
	});

	it('throws a generic error when the request itself fails', async () => {
		const fetcher = vi.fn(async () => {
			throw new Error('network down');
		});

		await expect(getUsdRubRate(fetcher as unknown as typeof fetch)).rejects.toThrow(
			'Exchange rate unavailable'
		);
	});

	it('throws a generic error on a non-OK response', async () => {
		const fetcher = vi.fn(async () => cbrResponse({}, 503));

		await expect(getUsdRubRate(fetcher as unknown as typeof fetch)).rejects.toThrow(
			'Exchange rate unavailable'
		);
	});

	it('throws a generic error when the response body is not valid JSON', async () => {
		const fetcher = vi.fn(
			async () =>
				new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } })
		);

		await expect(getUsdRubRate(fetcher as unknown as typeof fetch)).rejects.toThrow(
			'Exchange rate unavailable'
		);
	});

	it('throws a generic error when the USD field is missing', async () => {
		const fetcher = vi.fn(async () => cbrResponse({ Date: validBody.Date, Valute: {} }));

		await expect(getUsdRubRate(fetcher as unknown as typeof fetch)).rejects.toThrow(
			'Exchange rate unavailable'
		);
	});

	it('throws a generic error when the Date field cannot be parsed', async () => {
		const fetcher = vi.fn(async () =>
			cbrResponse({ Date: 'not-a-date', Valute: validBody.Valute })
		);

		await expect(getUsdRubRate(fetcher as unknown as typeof fetch)).rejects.toThrow(
			'Exchange rate unavailable'
		);
	});
});
