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
import type { RenderResponse } from '$lib/api/contract';
import { apiError, parseBody, styleTransferRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { assertGenerationAllowed, getCredit, getUserIdByPubkey } from '$lib/server/billing';
import { styleTransferInterior } from '$lib/server/generation';
import { recordGeneration } from '$lib/server/generations';

const STYLE_TRANSFER_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, styleTransferRequestSchema);
	if (!parsed.ok) return parsed.response;

	const db = getDb(platform);
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

	let precheckBalance: number | undefined;
	if (db && userId) {
		try {
			const check = await assertGenerationAllowed(db, userId);
			if (!check.allowed) {
				return check.reason === 'not_approved'
					? apiError(403, 'generation_restricted', 'Generation is limited to approved accounts')
					: apiError(402, 'insufficient_credit', 'Test balance exhausted');
			}
			precheckBalance = check.balance;
		} catch (err) {
			console.error('credit pre-check failed:', err);
			return apiError(500, 'style_transfer_failed', 'Style transfer failed');
		}
	}

	let result: RenderResponse;
	try {
		result = await styleTransferInterior(platform, parsed.data);
	} catch (err) {
		console.error(err);
		return apiError(500, 'style_transfer_failed', 'Style transfer failed');
	}

	if (db && userId) {
		try {
			const credit = await recordGeneration(db, userId, {
				url: result.outputUrl,
				sourceUrl: parsed.data.image,
				prompt: parsed.data.prompt ?? '',
				kind: 'style-transfer',
				amount: result.cost
			});
			result = { ...result, balance: credit.balance };
		} catch (err) {
			console.error('recordGeneration failed after a successful style transfer:', err);
			const fallback = await getCredit(db, userId).catch((fallbackErr) => {
				console.error(
					'balance fallback lookup failed after recordGeneration failure:',
					fallbackErr
				);
				return null;
			});
			result = { ...result, balance: fallback?.balance ?? precheckBalance ?? 0 };
		}
	}

	return json(result);
};
