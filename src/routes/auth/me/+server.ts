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
import { getCredit, getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { listCreditHistory } from '$lib/server/generations';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	// The demo session bypasses D1 entirely (hooks.server.ts) — no approved-account
	// balance to show; real sessions are always backed by a D1 user row.
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return json({ user: locals.user } satisfies MeResponse);
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);

	// Present only for an admin-approved account (a `credits` row) — absent for
	// every other login, same as before an admin ever approved anyone. This is
	// the only balance ever sent to the client — archAI's own (shared) account
	// balance is mirrored server-side (billing.ts) but never exposed here.
	let credit: MeResponse['credit'];
	if (userId) {
		const approved = await getCredit(db, userId);
		if (approved) {
			const history = await listCreditHistory(db, userId);
			credit = { balance: approved.balance, updatedAt: approved.updatedAt, history };
		}
	}

	return json({ user: locals.user, credit } satisfies MeResponse);
};
