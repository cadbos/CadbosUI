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

import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDepositRequestSchema } from '$lib/api/contract';
import { apiError, parseBody } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { getUserIdByPubkey } from '$lib/server/billing';
import { createOrResumeDeposit } from '$lib/server/deposit-reconciliation';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { LnbitsError } from '$lib/server/lnbits';
import { getLnbitsConfig } from '$lib/server/payment-config';
import { serializeDepositResponse } from '$lib/server/payments';

const CREATE_RATE_LIMIT = { windowMs: 60_000, max: 5 } as const;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(403, 'payments_unavailable', 'Payments are unavailable in demo mode');
	}
	const parsed = await parseBody(request, createDepositRequestSchema);
	if (!parsed.ok) return parsed.response;

	try {
		const db = getDb(platform);
		const userId = await getUserIdByPubkey(db, locals.user.pubkey);
		if (!userId) return apiError(500, 'account_error', 'Account record not found');
		if (
			await touchRateLimit(
				db,
				`deposit-create:${locals.user.pubkey}`,
				Date.now(),
				CREATE_RATE_LIMIT
			)
		) {
			return apiError(429, 'rate_limited', 'Too many payment attempts');
		}
		const deposit = await createOrResumeDeposit(db, userId, parsed.data, getLnbitsConfig(platform));
		return json(await serializeDepositResponse(db, deposit), {
			status: deposit.status === 'creating' ? 202 : 201,
			headers: { 'cache-control': 'no-store', location: `/api/deposits/${deposit.id}` }
		});
	} catch (error) {
		if (error instanceof Error && error.message === 'unknown_or_disabled_package') {
			return apiError(400, 'invalid_package', 'Payment package is unavailable');
		}
		console.error(
			'Payment invoice creation failed:',
			error instanceof LnbitsError
				? { operation: error.operation, outcome: error.outcome }
				: { errorName: error instanceof Error ? error.name : 'Error' }
		);
		return apiError(502, 'invoice_failed', 'Payment invoice could not be created');
	}
};
