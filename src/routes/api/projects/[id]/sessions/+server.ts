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
import type { CreateSessionResponse } from '$lib/api/contract';
import { apiError, createSessionRequestSchema, parseBody } from '$lib/server/api';
import { getDb } from '$lib/server/db';
import { getUserIdByPubkey } from '$lib/server/billing';
import { createSession } from '$lib/server/projects';

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, createSessionRequestSchema);
	if (!parsed.ok) return parsed.response;

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const session = await createSession(db, userId, params.id, parsed.data.title ?? '');
	if (!session) return apiError(404, 'project_not_found', 'Project not found');

	return json(
		{
			id: session.id,
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt
		} satisfies CreateSessionResponse,
		{ status: 201 }
	);
};
