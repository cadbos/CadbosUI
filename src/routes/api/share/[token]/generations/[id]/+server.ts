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
import type { ShareGenerationDetailResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getShareGenerationDetail } from '$lib/server/projects';

// The public, unauthenticated share viewer's lazy per-generation settings
// fetch — no locals.user check by design, same as GET /api/share/[token]
// itself. Text settings only: no media is resolved or returned here (see
// PublicFormSnapshot in $lib/api/contract for what's stripped and why).
export const GET: RequestHandler = async ({ params, platform }) => {
	const db = getDb(platform);
	const detail = await getShareGenerationDetail(db, params.token, params.id);
	if (!detail) return apiError(404, 'share_not_found', 'Share link not found');

	return json(
		{
			id: detail.id,
			prompt: detail.prompt,
			kind: detail.kind,
			createdAt: detail.createdAt,
			formSnapshot: detail.formSnapshot
		} satisfies ShareGenerationDetailResponse,
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
