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
import type { GeneratedImagesResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { listGeneratedImages } from '$lib/server/generated-images';

const DEFAULT_IMAGE_PAGE_OFFSET = 0;
const DEFAULT_IMAGE_PAGE_SIZE = 20;
const MAX_IMAGE_PAGE_SIZE = 100;

const generatedImagesSearchParamsSchema = z.strictObject({
	offset: z.coerce.number().int().min(0).default(DEFAULT_IMAGE_PAGE_OFFSET),
	size: z.coerce.number().int().min(1).max(MAX_IMAGE_PAGE_SIZE).default(DEFAULT_IMAGE_PAGE_SIZE)
});

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = generatedImagesSearchParamsSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) return apiError(400, 'invalid_request', 'Invalid search params');

	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const page = await listGeneratedImages(db, userId, parsed.data.offset, parsed.data.size);
	return json({
		images: page.images.map((image) => ({
			id: image.id,
			url: image.url,
			createdAt: image.createdAt
		})),
		pagination: {
			offset: parsed.data.offset,
			size: parsed.data.size,
			hasMore: page.hasMore
		}
	} satisfies GeneratedImagesResponse);
};
