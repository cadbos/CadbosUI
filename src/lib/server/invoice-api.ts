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

import { DrizzleQueryError } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { getDb, type Database } from '$lib/server/db';
import { InvoiceError } from '$lib/server/invoices';

const limits = { create: 10, checkout: 30, cancel: 30, read: 60 };

function uncached(response: Response): Response {
	response.headers.set('Cache-Control', 'no-store');
	return response;
}

export async function invoiceApi(
	event: RequestEvent,
	operation: keyof typeof limits,
	handle: (db: Database, userId: string) => Promise<Response>
): Promise<Response> {
	if (!event.locals.user) {
		return uncached(authenticationRequiredResponse(event.locals.sessionLookupUnavailable));
	}
	if (event.request.method === 'POST') {
		if (event.request.headers.get('origin') !== event.url.origin) {
			return uncached(apiError(403, 'invalid_origin', 'Same-origin request required'));
		}
		if (
			event.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
			'application/json'
		) {
			return uncached(apiError(400, 'invalid_request', 'JSON request required'));
		}
	}
	let db: Database;
	let userId: string | null;
	try {
		db = getDb(event.platform);
		userId = await getUserIdByPubkey(db, event.locals.user.pubkey);
	} catch (error) {
		console.error('Invoice account lookup failed', {
			operation,
			errorType: error instanceof Error ? error.name : typeof error
		});
		const response = apiError(503, 'account_unavailable', 'Account data unavailable');
		response.headers.set('Retry-After', '5');
		return uncached(response);
	}
	if (!userId) return uncached(apiError(500, 'account_error', 'Account record not found'));
	try {
		if (
			await touchRateLimit(db, `invoice:${operation}:${userId}`, Date.now(), {
				windowMs: 60_000,
				max: limits[operation]
			})
		) {
			const response = apiError(429, 'rate_limited', 'Too many requests');
			response.headers.set('Retry-After', '60');
			return uncached(response);
		}
		return uncached(await handle(db, userId));
	} catch (error) {
		if (!(error instanceof InvoiceError) || error.cause !== undefined || error.status >= 500) {
			console.error('Invoice API request failed', {
				operation,
				errorType: error instanceof Error ? error.name : typeof error,
				causeType:
					error instanceof Error && error.cause instanceof Error ? error.cause.name : undefined
			});
		}
		const response =
			error instanceof InvoiceError
				? apiError(error.status, error.code, error.message)
				: error instanceof DrizzleQueryError
					? apiError(503, 'account_unavailable', 'Account data unavailable')
					: apiError(500, 'invoice_error', 'Invoice request failed');
		if (response.status === 503) response.headers.set('Retry-After', '5');
		return uncached(response);
	}
}
