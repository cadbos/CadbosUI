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
import { DEMO_PUBKEY } from '$lib/server/demo';
import { lookupInvoice, parseNwcConnectionString } from '$lib/server/lightning';
import {
	expireStaleDeposits,
	getDeposit,
	markDepositPaid,
	type Deposit
} from '$lib/server/payments';

// There is no NWC webhook (lightning.ts) — this is the only place a pending
// deposit's status ever advances, by asking the held wallet directly. Bound
// well above the client's own ~2s poll interval so it isn't the limiting
// factor, but still a limit: this is a real relay round-trip, not a free read.
const DEPOSIT_STATUS_RATE_LIMIT = { windowMs: 10_000, max: 10 } as const;

function toDepositResponse(deposit: Deposit, balance?: number): DepositResponse {
	return {
		id: deposit.id,
		status: deposit.status,
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

	if (deposit.status === 'pending') {
		const limited = await touchRateLimit(
			db,
			`deposit-status:${locals.user.pubkey}`,
			Date.now(),
			DEPOSIT_STATUS_RATE_LIMIT
		);
		if (limited) return apiError(429, 'rate_limited', 'Too many requests');

		if (deposit.expiresAt <= Date.now()) {
			await expireStaleDeposits(db);
			deposit = (await getDeposit(db, params.id, userId)) ?? deposit;
		} else {
			const connectionString = platform?.env?.NWC_CONNECTION_STRING;
			if (connectionString) {
				try {
					const nwc = parseNwcConnectionString(connectionString);
					const status = await lookupInvoice(nwc, deposit.paymentHash);
					if (status.state === 'settled') {
						deposit = (await markDepositPaid(db, deposit.paymentHash)) ?? deposit;
					}
				} catch (err) {
					// A failed poll leaves the deposit pending — the client just polls
					// again; it never surfaces as an error to the buyer mid-payment.
					console.error('lookupInvoice poll failed:', err);
				}
			}
		}
	}

	const balance =
		deposit.status === 'paid' ? ((await getCredit(db, userId))?.balance ?? undefined) : undefined;

	return json(toDepositResponse(deposit, balance));
};
