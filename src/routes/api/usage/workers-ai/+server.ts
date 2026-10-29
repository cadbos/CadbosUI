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
import { authorizeUsageViewer } from '$lib/server/usage';
import { getWorkersAiDailyUsage } from '$lib/server/workers-ai-limits';

export const GET: RequestHandler = async ({ platform, locals, fetch }) => {
	const user = locals.user;
	if (!user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);

	const authorization = await authorizeUsageViewer(platform, user);
	if (authorization) return authorization;

	const usage = await getWorkersAiDailyUsage(platform?.env, fetch);
	if (!usage) {
		const response = apiError(
			503,
			'workers_ai_usage_unavailable',
			'Could not retrieve Workers AI usage'
		);
		response.headers.set('cache-control', 'private, no-store');
		return response;
	}
	return json(usage, { headers: { 'cache-control': 'private, no-store' } });
};
