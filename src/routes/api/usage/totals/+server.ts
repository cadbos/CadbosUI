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
import type { UsageTotals } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUsageTotals } from '$lib/server/generations';
import { getDb } from '$lib/server/db';
import { authorizeUsageViewer, isOrderedRange, usageRangeShape } from '$lib/server/usage';

const totalsSearchParamsSchema = z.union([
	z.strictObject(usageRangeShape).refine(isOrderedRange),
	z.strictObject({}).transform(() => undefined)
]);

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const user = locals.user;
	if (!user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);

	const authorization = await authorizeUsageViewer(platform, user);
	if (authorization) return authorization;

	const parsed = totalsSearchParamsSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) return apiError(400, 'invalid_request', 'Invalid search params');

	return json((await getUsageTotals(getDb(platform), parsed.data)) satisfies UsageTotals);
};
