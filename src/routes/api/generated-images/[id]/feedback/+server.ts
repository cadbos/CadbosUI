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

import { z } from 'zod';

import type { RequestHandler } from './$types';
import { apiError, parseBody } from '$lib/server/api';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { getDb } from '$lib/server/db';
import { storeGenerationFeedback } from '$lib/server/generations';

const feedbackRequestSchema = z.strictObject({
	rating: z.enum(['like', 'dislike']),
	comment: z.string().max(3000).nullable().optional()
});

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
	if (!locals.user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);

	const parsed = await parseBody(request, feedbackRequestSchema);
	if (!parsed.ok) return parsed.response;

	try {
		const db = getDb(platform);
		const userId = await getUserIdByPubkey(db, locals.user.pubkey);
		if (!userId) return apiError(500, 'account_error', 'Account record not found');

		const result = await storeGenerationFeedback(
			db,
			userId,
			params.id,
			parsed.data.rating,
			parsed.data.comment ?? null
		);
		if (result === 'not_found') {
			return apiError(404, 'generation_not_found', 'Generation not found');
		}
		if (result === 'conflict') {
			return apiError(409, 'feedback_conflict', 'Generation already has different feedback');
		}
		return new Response(null, { status: 204 });
	} catch (error) {
		console.error(
			JSON.stringify({
				level: 'error',
				area: 'generation_feedback',
				event: 'save_failed',
				errorType: error instanceof Error ? error.name : typeof error
			})
		);
		return apiError(500, 'feedback_error', 'Unable to store generation feedback');
	}
};
