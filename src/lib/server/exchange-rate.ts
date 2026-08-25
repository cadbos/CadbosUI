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

import { z } from 'zod';

const CBR_DAILY_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const FETCH_TIMEOUT_MS = 10_000;

// The Central Bank of Russia's free, keyless daily rates feed. We only care
// about USD; every other currency in the payload is stripped by zod.
const cbrResponseSchema = z.object({
	Date: z.string().min(1),
	Valute: z.object({
		USD: z.object({
			Value: z.number().positive(),
			Nominal: z.number().positive()
		})
	})
});

export interface UsdRubRate {
	rubPerUsd: number;
	asOf: string;
}

export async function getUsdRubRate(fetcher: typeof fetch): Promise<UsdRubRate> {
	let response: Response;
	try {
		response = await fetcher(CBR_DAILY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch (err) {
		console.error('CBR exchange rate fetch failed:', err);
		throw new Error('Exchange rate unavailable', { cause: err });
	}

	if (!response.ok) {
		console.error('CBR exchange rate fetch failed:', response.status);
		throw new Error('Exchange rate unavailable');
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch (err) {
		console.error('CBR exchange rate response invalid:', err);
		throw new Error('Exchange rate unavailable', { cause: err });
	}

	const parsed = cbrResponseSchema.safeParse(body);
	if (!parsed.success) {
		console.error('CBR exchange rate response invalid:', parsed.error.message);
		throw new Error('Exchange rate unavailable');
	}

	const asOfMs = Date.parse(parsed.data.Date);
	if (Number.isNaN(asOfMs)) {
		console.error('CBR exchange rate response invalid: unparseable Date field');
		throw new Error('Exchange rate unavailable');
	}

	const { Value, Nominal } = parsed.data.Valute.USD;
	return { rubPerUsd: Value / Nominal, asOf: new Date(asOfMs).toISOString() };
}
