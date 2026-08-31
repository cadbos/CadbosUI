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
import type { MeResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getCredit, getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { listCreditHistory } from '$lib/server/generations';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) {
		return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	}

	// The demo session bypasses D1 entirely (hooks.server.ts) — no approved-account
	// balance to show; real sessions are always backed by a D1 user row.
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return json({ user: locals.user } satisfies MeResponse);
	}

	// Present only for an admin-approved account (a `credits` row) — absent for
	// every other login, same as before an admin ever approved anyone. This is
	// the only balance ever sent to the client — archAI's own (shared) account
	// balance is mirrored server-side (billing.ts) but never exposed here.
	let credit: MeResponse['credit'];
	try {
		const db = getDb(platform);
		const userId = await getUserIdByPubkey(db, locals.user.pubkey);
		if (userId) {
			const approved = await getCredit(db, userId);
			if (approved) {
				const history = await listCreditHistory(db, userId);
				credit = { balance: approved.balance, updatedAt: approved.updatedAt, history };
			}
		}
	} catch (error) {
		// A transient D1 failure here is not proof the session is invalid — the
		// caller (auth.svelte.ts's loadSession) must retry rather than treat this
		// as a logout, or the sign-in indicator desyncs from the still-valid
		// session cookie every other endpoint keeps honoring.
		console.error(
			JSON.stringify({
				level: 'error',
				area: 'auth',
				event: 'me_billing_lookup_error',
				message: error instanceof Error ? error.message : 'Unknown billing lookup error'
			})
		);
		return accountLookupUnavailableResponse();
	}

	return json({ user: locals.user, credit } satisfies MeResponse);
};

function accountLookupUnavailableResponse(): Response {
	const response = apiError(503, 'account_unavailable', 'Account data temporarily unavailable');
	response.headers.set('Retry-After', '5');
	return response;
}
