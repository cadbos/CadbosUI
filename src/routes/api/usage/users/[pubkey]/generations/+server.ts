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
import type { UsageGenerationsResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { getDb } from '$lib/server/db';
import { listUserGenerations } from '$lib/server/generations';
import { authorizeUsageViewer, isOrderedRange, usageRangeShape } from '$lib/server/usage';

const DEFAULT_GENERATIONS_PAGE_OFFSET = 0;
const DEFAULT_GENERATIONS_PAGE_SIZE = 20;
const MAX_GENERATIONS_PAGE_SIZE = 100;

const generationsSearchParamsSchema = z
	.strictObject({
		...usageRangeShape,
		offset: z.coerce.number().int().min(0).default(DEFAULT_GENERATIONS_PAGE_OFFSET),
		size: z.coerce
			.number()
			.int()
			.min(1)
			.max(MAX_GENERATIONS_PAGE_SIZE)
			.default(DEFAULT_GENERATIONS_PAGE_SIZE)
	})
	.refine(isOrderedRange);

export const GET: RequestHandler = async ({ params, url, platform, locals }) => {
	const user = locals.user;
	if (!user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);

	const authorization = await authorizeUsageViewer(platform, user);
	if (authorization) return authorization;

	const parsed = generationsSearchParamsSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) return apiError(400, 'invalid_request', 'Invalid search params');
	const { from, to, offset, size } = parsed.data;

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, params.pubkey);
	if (userId === null) return apiError(404, 'user_not_found', 'User not found');

	const page = await listUserGenerations(db, userId, { from, to }, offset, size);
	return json({
		generations: page.generations,
		pagination: { offset, size, hasMore: page.hasMore }
	} satisfies UsageGenerationsResponse);
};
