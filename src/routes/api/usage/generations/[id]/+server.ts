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
import { z } from 'zod';
import type { RequestHandler } from './$types';
import type { AdminGenerationDetailResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { resolveGenerationMedia } from '$lib/server/generation-media';
import { getGenerationDetailForAdmin } from '$lib/server/generations';
import { authorizeUsageViewer } from '$lib/server/usage';

export const GET: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	const authorization = await authorizeUsageViewer(platform, locals.user);
	if (authorization) return authorization;
	const id = z.uuid().safeParse(params.id);
	if (!id.success) return apiError(400, 'invalid_request', 'Invalid generation ID');

	const db = getDb(platform);
	const detail = await getGenerationDetailForAdmin(db, locals.user.pubkey, id.data);
	if (!detail) return apiError(404, 'generation_not_found', 'Generation not found');
	const { image, source, reference, media } = await resolveGenerationMedia(db, detail);

	return json(
		{
			id: detail.id,
			prompt: detail.prompt,
			translatedPrompt: detail.translatedPrompt,
			kind: detail.kind,
			createdAt: detail.createdAt,
			image,
			source,
			reference,
			hasReference: detail.referenceMediaId !== null,
			formSnapshot: detail.formSnapshot,
			media,
			project: detail.project,
			session: detail.session
		} satisfies AdminGenerationDetailResponse,
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
