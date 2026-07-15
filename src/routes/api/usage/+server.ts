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
import type { UserUsageResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { listUserUsage } from '$lib/server/generations';
import { authorizeUsageViewer, getUsageViewerDb } from '$lib/server/usage';

const DEFAULT_USAGE_PAGE_OFFSET = 0;
const DEFAULT_USAGE_PAGE_SIZE = 20;
const MAX_USAGE_PAGE_SIZE = 100;

const usageSearchParamsSchema = z.strictObject({
	offset: z.coerce.number().int().min(0).default(DEFAULT_USAGE_PAGE_OFFSET),
	size: z.coerce.number().int().min(1).max(MAX_USAGE_PAGE_SIZE).default(DEFAULT_USAGE_PAGE_SIZE)
});

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'unauthorized', 'Authentication required');

	const authorization = authorizeUsageViewer(platform, user);
	if (authorization) return authorization;

	const parsed = usageSearchParamsSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) return apiError(400, 'invalid_request', 'Invalid search params');

	const db = await getUsageViewerDb(platform, user.pubkey);
	if (db instanceof Response) return db;

	const page = await listUserUsage(db, parsed.data.offset, parsed.data.size);
	return json({
		users: page.users,
		pagination: {
			offset: parsed.data.offset,
			size: parsed.data.size,
			hasMore: page.hasMore
		}
	} satisfies UserUsageResponse);
};
