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
import { apiError } from '$lib/server/api';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getD1DailyLimits } from '$lib/server/d1-limits';
import { authorizeUsageViewer } from '$lib/server/usage';

export const GET: RequestHandler = async ({ platform, locals, fetch }) => {
	const user = locals.user;
	if (!user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);

	const authorization = await authorizeUsageViewer(platform, user);
	if (authorization) return authorization;

	const limits = await getD1DailyLimits(platform?.env, fetch);
	if (!limits) {
		const response = apiError(503, 'd1_limits_unavailable', 'Could not retrieve D1 limits');
		response.headers.set('cache-control', 'private, no-store');
		return response;
	}
	return json(limits, { headers: { 'cache-control': 'private, no-store' } });
};
