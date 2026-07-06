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
import type { RenderResponse } from '$lib/api/contract';
import { apiError, parseBody, renderRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import {
	deductCredit,
	getOrCreateCredit,
	getUserIdByPubkey,
	hasSufficientCredit,
	isMeteredPubkey,
	recordBalance
} from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { GeneratedImageRecordError, recordGeneratedImage } from '$lib/server/generated-images';
import { renderInterior } from '$lib/server/generation';

// Session is enforced centrally in hooks.server.ts (guardedPaths). Spend limits
// are archAI's job for everyone else — it already rejects a call it can't
// afford — except for metered evaluation accounts (METERED_DESIGNER_PUBKEYS),
// which also get a local credit pre-check/deduction (billing.ts).
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, renderRequestSchema);
	if (!parsed.ok) return parsed.response;

	// The demo session bypasses D1 entirely (hooks.server.ts) — no balance to record.
	const demoUser = dev && locals.user.pubkey === DEMO_PUBKEY;
	const db = demoUser ? null : getDb(platform);
	const userId = db ? await getUserIdByPubkey(db, locals.user.pubkey) : null;

	// A real session is only ever set from a D1 users↔sessions join (hooks.server.ts),
	// so a resolvable session with no matching user row is a data-integrity fault, not
	// a normal case — fail closed rather than charge a call we can't attribute.
	if (db && !userId) return apiError(500, 'account_error', 'Account record not found');

	const metered = Boolean(
		db && userId && isMeteredPubkey(platform?.env?.METERED_DESIGNER_PUBKEYS, locals.user.pubkey)
	);
	if (metered && db && userId) {
		const credit = await getOrCreateCredit(db, userId);
		if (!hasSufficientCredit(credit)) {
			return apiError(402, 'insufficient_credit', 'Test balance exhausted');
		}
	}

	let result: RenderResponse;
	try {
		result = await renderInterior(platform, parsed.data);
	} catch (err) {
		if (err instanceof GeneratedImageRecordError) {
			console.error('recordGeneratedImage failed after a successful render:', err);
			if (err.code === 'unknown_user_id') {
				return apiError(500, 'account_error', 'Account record not found');
			}
			return apiError(500, 'image_record_failed', 'Image record failed');
		}

		// generation.ts already sanitizes/logs the detail; this route is the last
		// line of defense (NFR-6/8) — never forward err.message to the client.
		console.error(err);
		return apiError(500, 'render_failed', 'Render failed');
	}

	if (db && userId) {
		try {
			await recordGeneratedImage(db, userId, result.outputUrl);
		} catch (err) {
			console.error('recordGeneratedImage failed after a successful render:', err);
		}

		try {
			await recordBalance(db, userId, result.balance);
		} catch (err) {
			console.error('recordBalance failed after a successful render:', err);
		}

		if (metered) {
			try {
				const credit = await deductCredit(db, userId, result.cost, 'render');
				result = { ...result, balance: credit.balance };
			} catch (err) {
				console.error('deductCredit failed after a successful render:', err);
				const fallback = await getOrCreateCredit(db, userId).catch(() => null);
				if (fallback) result = { ...result, balance: fallback.balance };
			}
		}
	}

	return json(result);
};
