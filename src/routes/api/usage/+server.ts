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
import type { UserUsageResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { listUserUsage } from '$lib/server/generations';

const DEFAULT_USAGE_PAGE_OFFSET = 0;
const DEFAULT_USAGE_PAGE_SIZE = 20;
const MAX_USAGE_PAGE_SIZE = 100;

const usageSearchParamsSchema = z.strictObject({
	offset: z.coerce.number().int().min(0).default(DEFAULT_USAGE_PAGE_OFFSET),
	size: z.coerce.number().int().min(1).max(MAX_USAGE_PAGE_SIZE).default(DEFAULT_USAGE_PAGE_SIZE)
});

function isAdminPubkey(pubkey: string, adminPubkeys: string | undefined): boolean {
	return (
		adminPubkeys
			?.split(',')
			.map((adminPubkey) => adminPubkey.trim())
			.includes(pubkey) ?? false
	);
}

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	if (!isAdminPubkey(locals.user.pubkey, platform?.env?.ADMIN_PUBKEYS)) {
		return apiError(403, 'forbidden', 'Admin access required');
	}

	const parsed = usageSearchParamsSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) return apiError(400, 'invalid_request', 'Invalid search params');

	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

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
