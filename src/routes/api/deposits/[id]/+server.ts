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
import type { DepositResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { getCredit, getUserIdByPubkey } from '$lib/server/billing';
import { reconcileDeposit } from '$lib/server/deposit-reconciliation';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { parseNwcConnectionString } from '$lib/server/lightning';
import { depositNeedsReconciliation, getDeposit, type Deposit } from '$lib/server/payments';

const DEPOSIT_STATUS_RATE_LIMIT = { windowMs: 10_000, max: 10 } as const;

function toDepositResponse(deposit: Deposit, balance?: number): DepositResponse {
	return {
		id: deposit.id,
		status: depositNeedsReconciliation(deposit) ? 'pending' : deposit.status,
		bolt11: deposit.bolt11,
		satsAmount: deposit.satsAmount,
		usdAmount: deposit.usdAmount,
		expiresAt: deposit.expiresAt,
		...(balance !== undefined ? { balance } : {})
	};
}

// Session is enforced centrally in hooks.server.ts (guardedPaths).
export const GET: RequestHandler = async ({ platform, locals, params }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(403, 'demo_unavailable', 'Purchases are not available in the demo');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	let deposit = await getDeposit(db, params.id, userId);
	if (!deposit) return apiError(404, 'not_found', 'Deposit not found');

	if (depositNeedsReconciliation(deposit)) {
		const now = Date.now();
		const limited = await touchRateLimit(
			db,
			`deposit-status:${locals.user.pubkey}`,
			now,
			DEPOSIT_STATUS_RATE_LIMIT
		);
		if (limited) return apiError(429, 'rate_limited', 'Too many requests');

		const connectionString = platform?.env?.NWC_CONNECTION_STRING;
		if (!connectionString) {
			console.error('Deposit reconciliation unavailable: NWC connection is not configured');
			return apiError(
				503,
				'deposit_status_unavailable',
				'Payment status is temporarily unavailable'
			);
		}

		try {
			const nwc = parseNwcConnectionString(connectionString);
			deposit = await reconcileDeposit(db, deposit, nwc, { now });
		} catch (err) {
			console.error('Deposit reconciliation failed:', {
				operation: 'lookup_invoice',
				errorName: err instanceof Error ? err.name : 'UnknownError'
			});
		}
	}

	const balance =
		deposit.status === 'paid' ? ((await getCredit(db, userId))?.balance ?? undefined) : undefined;

	return json(toDepositResponse(deposit, balance));
};
