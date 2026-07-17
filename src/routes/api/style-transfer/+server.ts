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
import type { RequestHandler } from './$types';
import { apiError, parseBody, styleTransferRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { styleTransferInterior } from '$lib/server/generation';
import { runPaidGeneration } from '$lib/server/paid-generation';

const STYLE_TRANSFER_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, styleTransferRequestSchema);
	if (!parsed.ok) return parsed.response;

	const demoUser = dev && locals.user.pubkey === DEMO_PUBKEY;
	const db = demoUser ? null : getDb(platform);
	const userId = db ? await getUserIdByPubkey(db, locals.user.pubkey) : null;

	if (db && !userId) return apiError(500, 'account_error', 'Account record not found');

	if (db) {
		const limited = await touchRateLimit(
			db,
			`style-transfer:${locals.user.pubkey}`,
			Date.now(),
			STYLE_TRANSFER_RATE_LIMIT
		);
		if (limited) return apiError(429, 'rate_limited', 'Too many requests');
	}

	try {
		if (db && userId) {
			const result = await runPaidGeneration(
				db,
				userId,
				{
					sourceUrl: parsed.data.image,
					prompt: parsed.data.prompt ?? '',
					kind: 'style-transfer'
				},
				() => styleTransferInterior(platform, parsed.data)
			);
			if (!result.allowed) {
				return result.reason === 'not_approved'
					? apiError(403, 'generation_restricted', 'Generation is limited to approved accounts')
					: apiError(402, 'insufficient_credit', 'Test balance exhausted');
			}
			return json(result.response);
		}
		return json(await styleTransferInterior(platform, parsed.data));
	} catch (err) {
		console.error('style transfer operation failed:', err);
		return apiError(500, 'style_transfer_failed', 'Style transfer failed');
	}
};
