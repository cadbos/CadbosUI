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
import type { GenerationEstimatesResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { getGenerationEstimates } from '$lib/server/generation-estimates';

export const GET: RequestHandler = async ({ platform, locals }) => {
	if (!locals.user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);

	let estimates;
	try {
		estimates = await getGenerationEstimates(getDb(platform));
	} catch (error) {
		console.error('Generation estimates failed:', error);
		return apiError(500, 'generation_estimates_failed', 'Generation estimates failed');
	}
	return json({ estimates } satisfies GenerationEstimatesResponse, {
		headers: { 'cache-control': 'private, max-age=300' }
	});
};
