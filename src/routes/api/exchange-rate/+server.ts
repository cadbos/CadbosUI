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
import { getUsdRubRate } from '$lib/server/exchange-rate';

// CBR publishes once a day; a multi-hour edge cache keeps us well inside
// their fair-use expectations without ever showing a stale rate for long.
const CACHE_TTL_SECONDS = 6 * 60 * 60;

interface ExchangeRateCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

function cacheKey(request: Request): Request {
	const url = new URL(request.url);
	url.pathname = '/api/exchange-rate';
	url.search = '';
	url.hash = '';
	return new Request(url);
}

function logCacheError(operation: 'read' | 'write', error: unknown): void {
	console.error(
		`Exchange rate cache ${operation} failed:`,
		error instanceof Error ? error.name : typeof error
	);
}

export const GET: RequestHandler = async ({ request, platform, fetch }) => {
	const cache = platform?.caches.default as unknown as ExchangeRateCache | undefined;
	const key = cacheKey(request);

	if (cache) {
		try {
			const cached = await cache.match(key);
			if (cached) return cached;
		} catch (error) {
			logCacheError('read', error);
		}
	}

	let rate: Awaited<ReturnType<typeof getUsdRubRate>>;
	try {
		rate = await getUsdRubRate(fetch);
	} catch (error) {
		console.error('Exchange rate request failed:', error);
		return json(
			{ error: { code: 'exchange_rate_unavailable', message: 'Exchange rate unavailable' } },
			{ status: 502 }
		);
	}

	const response = json(
		{ rubPerUsd: rate.rubPerUsd, asOf: rate.asOf },
		{ headers: { 'cache-control': `public, max-age=${CACHE_TTL_SECONDS}` } }
	);

	if (cache) {
		try {
			await cache.put(key, response.clone());
		} catch (error) {
			logCacheError('write', error);
		}
	}
	return response;
};
