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
import type { GeneratedImageDetailResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { getDb } from '$lib/server/db';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { getGenerationDetailForUser } from '$lib/server/generations';
import { resolveGenerationMedia, withAvailableReferenceImages } from '$lib/server/generation-media';

export const GET: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) {
		return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	}
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const detail = await getGenerationDetailForUser(db, userId, params.id);
	if (!detail) return apiError(404, 'generation_not_found', 'Generation not found');

	const { image, source, referencedAccess, media } = await resolveGenerationMedia(db, detail);
	if (!image || !source) return apiError(404, 'image_not_found', 'Image not found');

	const formSnapshot = detail.formSnapshot
		? withAvailableReferenceImages(detail.formSnapshot, referencedAccess)
		: null;

	return json(
		{
			id: detail.id,
			prompt: detail.prompt,
			kind: detail.kind,
			createdAt: detail.createdAt,
			amount: detail.amount,
			balanceAfter: detail.balanceAfter,
			image,
			source,
			formSnapshot,
			session: detail.session,
			media
		} satisfies GeneratedImageDetailResponse,
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
