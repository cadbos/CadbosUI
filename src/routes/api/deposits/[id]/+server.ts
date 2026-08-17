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
import { depositIdSchema } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { getUserIdByPubkey } from '$lib/server/billing';
import { depositNeedsReconciliation, reconcileDeposit } from '$lib/server/deposit-reconciliation';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { getLnbitsConfig } from '$lib/server/payment-config';
import { getDeposit, serializeDepositResponse } from '$lib/server/payments';

const STATUS_RATE_LIMIT = { windowMs: 10_000, max: 10 } as const;

export const GET: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(403, 'payments_unavailable', 'Payments are unavailable in demo mode');
	}
	const parsedId = depositIdSchema.safeParse(params.id);
	if (!parsedId.success) return apiError(404, 'deposit_not_found', 'Payment attempt not found');
	try {
		const db = getDb(platform);
		const userId = await getUserIdByPubkey(db, locals.user.pubkey);
		if (!userId) return apiError(500, 'account_error', 'Account record not found');
		let deposit = await getDeposit(db, parsedId.data, userId);
		if (!deposit) return apiError(404, 'deposit_not_found', 'Payment attempt not found');
		const now = Date.now();
		if (depositNeedsReconciliation(deposit, now)) {
			if (
				await touchRateLimit(db, `deposit-status:${locals.user.pubkey}`, now, STATUS_RATE_LIMIT)
			) {
				return apiError(429, 'rate_limited', 'Too many status checks');
			}
			deposit = await reconcileDeposit(db, deposit, getLnbitsConfig(platform), { now });
		}
		return json(await serializeDepositResponse(db, deposit), {
			status: deposit.status === 'creating' ? 202 : 200,
			headers: { 'cache-control': 'no-store', 'retry-after': '2' }
		});
	} catch (error) {
		console.error('Payment status reconciliation failed:', {
			errorName: error instanceof Error ? error.name : 'Error'
		});
		return apiError(502, 'status_failed', 'Payment status is temporarily unavailable');
	}
};
