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
import { getBalance, getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_BALANCE, DEMO_PUBKEY } from '$lib/server/demo';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	// The demo session bypasses D1 entirely (hooks.server.ts) and always gets the
	// hardcoded showcase balance; real sessions are always backed by a D1 user row.
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return json({ user: locals.user, balance: DEMO_BALANCE } satisfies MeResponse);
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	// undefined (not a default) until the user has generated at least once.
	const balance = userId ? ((await getBalance(db, userId)) ?? undefined) : undefined;

	return json({ user: locals.user, balance } satisfies MeResponse);
};
