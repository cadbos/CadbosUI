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
import { z } from 'zod';
import type { RequestHandler } from './$types';
import type { ResourceDetailResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { getResourceRoles, listResourceGenerations } from '$lib/server/generations';
import { getMediaByBucketKey, parseMediaKey } from '$lib/server/media';
import { mediaAccessBatch } from '$lib/server/media-access';

const DEFAULT_PAGE_OFFSET = 0;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

const searchParamsSchema = z.strictObject({
	offset: z.coerce.number().int().min(0).default(DEFAULT_PAGE_OFFSET),
	size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
});

export const GET: RequestHandler = async ({ params, url, platform, locals }) => {
	if (!locals.user) {
		return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	}

	const parsed = searchParamsSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) return apiError(400, 'invalid_request', 'Invalid search params');
	const key = parseMediaKey(params.key);
	if (!key) return apiError(404, 'resource_not_found', 'Resource not found');

	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(404, 'resource_not_found', 'Resource not found');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	// An image counts as this user's resource only through their own
	// generations — the same 404 for "no such image" and "someone else's",
	// so the endpoint never confirms another user's upload exists.
	const media = await getMediaByBucketKey(db, key.bucketName, key.filename);
	const roles = media ? await getResourceRoles(db, userId, media.id) : [];
	if (!media || roles.length === 0) {
		return apiError(404, 'resource_not_found', 'Resource not found');
	}

	const page = await listResourceGenerations(
		db,
		userId,
		media.id,
		parsed.data.offset,
		parsed.data.size
	);
	const access = await mediaAccessBatch(db, platform, [
		media.id,
		...page.generations.map((generation) => generation.resultMediaId)
	]);
	if (!access) return apiError(404, 'image_not_found', 'Image not found');

	return json(
		{
			image: access.get(media.id)!,
			roles,
			generations: page.generations.map((generation) => ({
				id: generation.id,
				kind: generation.kind,
				createdAt: generation.createdAt,
				image: access.get(generation.resultMediaId)!,
				roles: generation.roles,
				session: generation.session,
				settingsSaved: generation.settingsSaved
			})),
			pagination: {
				offset: parsed.data.offset,
				size: parsed.data.size,
				hasMore: page.hasMore
			}
		} satisfies ResourceDetailResponse,
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
