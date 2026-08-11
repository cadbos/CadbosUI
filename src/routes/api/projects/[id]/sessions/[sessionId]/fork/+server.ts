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
import type { ForkSessionResponse } from '$lib/api/contract';
import { apiError, forkSessionRequestSchema, parseBody } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getUserIdByPubkey } from '$lib/server/billing';
import { forkSession } from '$lib/server/projects';

// The style-transfer fork point: branches a new session off params.sessionId at
// the exact generation forkedFromGenerationId. forkSession itself resolves and
// verifies ownership of the parent session (and that the generation is really
// one of its own) — params.id is only the URL's project scoping, not re-checked
// here, since the session-level check is what actually authorizes this.
export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, forkSessionRequestSchema);
	if (!parsed.ok) return parsed.response;

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const session = await forkSession(
		db,
		userId,
		params.sessionId,
		parsed.data.forkedFromGenerationId,
		parsed.data.title ?? ''
	);
	if (!session) return apiError(404, 'session_not_found', 'Session not found');

	return json(
		{
			id: session.id,
			title: session.title,
			parentSessionId: session.parentSessionId as string,
			forkedFromGenerationId: session.forkedFromGenerationId as string,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt
		} satisfies ForkSessionResponse,
		{ status: 201 }
	);
};
