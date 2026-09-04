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
import type { RenameSessionResponse } from '$lib/api/contract';
import { apiError, parseBody, renameSessionRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/db';
import { getUserIdByPubkey } from '$lib/server/billing';
import { archiveSession, renameSession } from '$lib/server/projects';

// renameSession itself resolves and verifies ownership through the session's
// own project — params.id is only the URL's project scoping, not re-checked
// here, same precedent as the fork route.
export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, renameSessionRequestSchema);
	if (!parsed.ok) return parsed.response;

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const session = await renameSession(db, userId, params.sessionId, parsed.data.title);
	if (!session) return apiError(404, 'session_not_found', 'Session not found');

	return json({
		id: session.id,
		title: session.title,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt
	} satisfies RenameSessionResponse);
};

// Soft delete (projects.ts's archiveSession) — hides the session from the
// project page but keeps its generations intact.
export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const archived = await archiveSession(db, userId, params.sessionId);
	if (!archived) return apiError(404, 'session_not_found', 'Session not found');

	return new Response(null, { status: 204 });
};
