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
import { apiError, createDepositRequestSchema, parseBody } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { parseNwcConnectionString } from '$lib/server/lightning';
import { createDeposit } from '$lib/server/payments';

// Each invoice creation round-trips the held wallet over a Nostr relay, well
// past the cost of a normal write — a tighter bucket than the paid-generation
// routes' 10/min.
const CREATE_DEPOSIT_RATE_LIMIT = { windowMs: 60_000, max: 5 } as const;

function toDepositResponse(deposit: {
	id: string;
	status: DepositResponse['status'];
	bolt11: string;
	satsAmount: number;
	usdAmount: number;
	expiresAt: number;
}): DepositResponse {
	return {
		id: deposit.id,
		status: deposit.status,
		bolt11: deposit.bolt11,
		satsAmount: deposit.satsAmount,
		usdAmount: deposit.usdAmount,
		expiresAt: deposit.expiresAt
	};
}

// Session is enforced centrally in hooks.server.ts (guardedPaths). No
// admin-approval gate is required here (unlike /api/render's generation_access
// check) — buying a package is how an account gets app-credit in the first
// place, not something that presupposes already having it.
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, createDepositRequestSchema);
	if (!parsed.ok) return parsed.response;

	// The demo session bypasses D1 entirely (hooks.server.ts) and must never
	// touch the real held wallet.
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(403, 'demo_unavailable', 'Purchases are not available in the demo');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const limited = await touchRateLimit(
		db,
		`deposits:${locals.user.pubkey}`,
		Date.now(),
		CREATE_DEPOSIT_RATE_LIMIT
	);
	if (limited) return apiError(429, 'rate_limited', 'Too many requests');

	const connectionString = platform?.env?.NWC_CONNECTION_STRING;
	if (!connectionString) {
		console.error('NWC_CONNECTION_STRING is not configured');
		return apiError(500, 'deposit_failed', 'Purchases are temporarily unavailable');
	}

	try {
		const nwc = parseNwcConnectionString(connectionString);
		const deposit = await createDeposit(db, userId, nwc, { packageId: parsed.data.packageId });
		return json(toDepositResponse(deposit));
	} catch (err) {
		if (err instanceof Error && err.message.startsWith('unknown or disabled package')) {
			return apiError(400, 'invalid_package', 'Unknown or disabled package');
		}
		console.error('createDeposit failed:', err);
		return apiError(500, 'deposit_failed', 'Could not create invoice');
	}
};
