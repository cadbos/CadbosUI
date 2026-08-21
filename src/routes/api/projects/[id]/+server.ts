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
import type { ProjectDetailResponse, ProjectRecord } from '$lib/api/contract';
import { apiError, parseBody, renameProjectRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getUserIdByPubkey } from '$lib/server/billing';
import { archiveProject, getProjectDetail, renameProject } from '$lib/server/projects';

export const GET: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const project = await getProjectDetail(db, userId, params.id);
	if (!project) return apiError(404, 'project_not_found', 'Project not found');

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
				createdAt: generation.createdAt,
				amount: generation.amount,
				balanceAfter: generation.balanceAfter
			}))
		}))
	} satisfies ProjectDetailResponse);
};

export const PATCH: RequestHandler = async ({ request, params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, renameProjectRequestSchema);
	if (!parsed.ok) return parsed.response;

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const project = await renameProject(db, userId, params.id, parsed.data.title);
	if (!project) return apiError(404, 'project_not_found', 'Project not found');

	return json({
		id: project.id,
		title: project.title,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt
	} satisfies ProjectRecord);
};

// Soft delete (projects.ts's archiveProject) — idempotent-from-the-client's
// perspective is not the goal here: an already-archived or foreign project
// both 404, same no-enumeration-signal rule as everywhere else in this module.
export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const archived = await archiveProject(db, userId, params.id);
	if (!archived) return apiError(404, 'project_not_found', 'Project not found');

	return new Response(null, { status: 204 });
};
