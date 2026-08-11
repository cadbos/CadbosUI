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
import type { ProjectDetailResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getProjectDetailByShareToken } from '$lib/server/projects';

// The public, unauthenticated viewer for a project share link — no
// locals.user check by design (that's the whole point of the token). Returns
// the same shape as GET /api/projects/[id], minus anything ownership-related.
export const GET: RequestHandler = async ({ params, platform }) => {
	const db = getDb(platform);
	const project = await getProjectDetailByShareToken(db, params.token);
	if (!project) return apiError(404, 'share_not_found', 'Share link not found');

	return json({
		id: project.id,
		title: project.title,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
		shareActive: project.shareActive,
		sessions: project.sessions.map((session) => ({
			id: session.id,
			title: session.title,
			parentSessionId: session.parentSessionId,
			forkedFromGenerationId: session.forkedFromGenerationId,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			generations: session.generations.map((generation) => ({
				id: generation.id,
				url: generation.url,
				sourceUrl: generation.sourceUrl,
				kind: generation.kind,
				createdAt: generation.createdAt
			}))
		}))
	} satisfies ProjectDetailResponse);
};
