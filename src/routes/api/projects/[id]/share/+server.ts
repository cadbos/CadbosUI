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
import type { ShareTokenResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getUserIdByPubkey } from '$lib/server/billing';
import { issueShareToken, revokeActiveShareToken } from '$lib/server/projects';

// Issuing a token auto-revokes the project's prior active one (projects.ts) —
// one active share link per project at a time.
export const POST: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const token = await issueShareToken(db, userId, params.id);
	if (!token) return apiError(404, 'project_not_found', 'Project not found');

	return json({ token } satisfies ShareTokenResponse, { status: 201 });
};

// Revokes whichever share token is currently active — the client never needs
// to know (or have kept) the token value itself, since the server only ever
// returns it once, at issuance.
export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const revoked = await revokeActiveShareToken(db, userId, params.id);
	if (!revoked) return apiError(404, 'share_not_found', 'Share link not found');

	return new Response(null, { status: 204 });
};
