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
import { apiError, editRequestSchema, parseBody } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import {
	deductCredit,
	getCredit,
	getUserIdByPubkey,
	hasGenerationAccess,
	hasSufficientCredit,
	recordBalance
} from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { GeneratedImageRecordError, recordGeneratedImage } from '$lib/server/generated-images';
import { editInterior } from '$lib/server/generation';

// Anti-cost-abuse (FR-К5): each edit is its own paid call, so it gets its own
// rate-limit bucket, bound to the authenticated pubkey rather than IP.
const EDIT_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;

// Session is enforced centrally in hooks.server.ts (guardedPaths). Editing
// itself is restricted further, by design: only accounts an admin has
// manually approved (a `credits` row, billing.ts) may edit at all — a fresh
// Nostr login alone is not enough (mirrors /api/render).
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, editRequestSchema);
	if (!parsed.ok) return parsed.response;

	// The demo session bypasses D1 entirely (hooks.server.ts) — no balance to record
	// and no rate-limit bucket to touch.
	const demoUser = dev && locals.user.pubkey === DEMO_PUBKEY;
	const db = demoUser ? null : getDb(platform);
	const userId = db ? await getUserIdByPubkey(db, locals.user.pubkey) : null;

	// A real session is only ever set from a D1 users↔sessions join (hooks.server.ts),
	// so a resolvable session with no matching user row is a data-integrity fault, not
	// a normal case — fail closed rather than charge a call we can't attribute.
	if (db && !userId) return apiError(500, 'account_error', 'Account record not found');

	if (db) {
		const limited = await touchRateLimit(
			db,
			`edit:${locals.user.pubkey}`,
			Date.now(),
			EDIT_RATE_LIMIT
		);
		if (limited) return apiError(429, 'rate_limited', 'Too many requests');
	}

	if (db && userId) {
		try {
			const credit = await getCredit(db, userId);
			if (!hasGenerationAccess(credit)) {
				return apiError(403, 'generation_restricted', 'Generation is limited to approved accounts');
			}
			if (!hasSufficientCredit(credit)) {
				return apiError(402, 'insufficient_credit', 'Test balance exhausted');
			}
		} catch (err) {
			console.error('credit pre-check failed:', err);
			return apiError(500, 'edit_failed', 'Edit failed');
		}
	}

	let result: RenderResponse;
	try {
		result = await editInterior(platform, parsed.data);
	} catch (err) {
		// generation.ts already sanitizes/logs the detail; this route is the last
		// line of defense (NFR-6/8) — never forward err.message to the client.
		console.error(err);
		return apiError(500, 'edit_failed', 'Edit failed');
	}

	// The edit already succeeded and archAI already charged for it — a failure to
	// cache the resulting balance/deduction is a bookkeeping gap, not a reason to
	// make the user think a completed, paid edit failed.
	if (db && userId) {
		// recordBalance mirrors archAI's own (shared) account balance for ops
		// visibility only — it must never reach the client, so read it before
		// overwriting `result.balance` with the caller's own remaining limit.
		try {
			await recordGeneratedImage(db, userId, result.outputUrl);
		} catch (err) {
			console.error('recordGeneratedImage failed after a successful edit:', err);
			if (err instanceof GeneratedImageRecordError && err.code === 'unknown_user_id') {
				return apiError(500, 'account_error', 'Account record not found');
			}
			return apiError(500, 'image_record_failed', 'Image record failed');
		}

		try {
			await recordBalance(db, userId, result.balance);
		} catch (err) {
			console.error('recordBalance failed after a successful edit:', err);
		}
		try {
			const credit = await deductCredit(db, userId, result.cost, 'edit');
			result = { ...result, balance: credit.balance };
		} catch (err) {
			console.error('deductCredit failed after a successful edit:', err);
			// Even on failure, never fall through to archAI's raw (shared) balance —
			// fall back to the last-known approved-account balance instead.
			const fallback = await getCredit(db, userId).catch(() => null);
			if (fallback) result = { ...result, balance: fallback.balance };
		}
	}

	return json(result);
};
