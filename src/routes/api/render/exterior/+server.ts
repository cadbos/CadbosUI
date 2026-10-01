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
import { apiError, parseBody, renderRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import {
	assertGenerationAllowed,
	getCredit,
	getUserIdByPubkey,
	recordBalance
} from '$lib/server/billing';
import { renderExterior, type StoredRenderResponse } from '$lib/server/generation';
import { recordGeneration } from '$lib/server/generations';
import { getOrCreateMediaByKey } from '$lib/server/media';
import { mediaAccess, providerMediaBatch } from '$lib/server/media-access';
import { assertSessionOwnedByUser } from '$lib/server/projects';

// Generation is restricted further, by design: only accounts an admin has
// manually approved (a `credits` row, billing.ts) may render at all — a
// fresh Nostr login alone is not enough (mirrors /api/render and /api/edit).
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) {
		return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	}

	const parsed = await parseBody(request, renderRequestSchema);
	if (!parsed.ok) return parsed.response;

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);

	// A session is only ever set from a D1 users↔sessions join (hooks.server.ts),
	// so a resolvable session with no matching user row is a data-integrity fault, not
	// a normal case — fail closed rather than charge a call we can't attribute.
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	// The account's own balance right before this call — kept as the final,
	// definitely-safe fallback if both recordGeneration and its own getCredit
	// fallback fail below, so the response never falls through to
	// renderExterior's raw (shared) archAI balance.
	let precheckBalance: number | undefined;
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
		return apiError(500, 'render_failed', 'Render failed');
	}

	const sessionOwned = await assertSessionOwnedByUser(db, userId, parsed.data.sessionId);
	if (!sessionOwned) return apiError(404, 'session_not_found', 'Session not found');

	const source = await providerMediaBatch(db, platform, [parsed.data.imageKey]);
	const sourceImage = source?.get(parsed.data.imageKey);
	if (!sourceImage) return apiError(404, 'image_not_found', 'Image not found');
	const sourceMedia = sourceImage.media;
	const uploadsBucket = sourceMedia.bucket;

	let result: StoredRenderResponse;
	try {
		result = await renderExterior(platform, uploadsBucket, {
			...parsed.data,
			image: sourceImage.url
		});
	} catch (err) {
		// generation.ts already sanitizes/logs the detail; this route is the last
		// line of defense (NFR-6/8) — never forward err.message to the client.
		console.error(err);
		return apiError(500, 'render_failed', 'Render failed');
	}

	// The render already succeeded and archAI already charged for it — a failure to
	// cache the resulting balance/deduction is a bookkeeping gap, not a reason to
	// make the user think a completed, paid render failed.
	let generationId: string | undefined;
	const outputMedia = await getOrCreateMediaByKey(
		db,
		uploadsBucket,
		result.outputKey,
		result.outputHash,
		result.outputSize
	);
	// recordBalance mirrors archAI's own (shared) account balance for ops
	// visibility only — it must never reach the client, so read it before
	// overwriting `result.balance` with the caller's own remaining limit.
	try {
		await recordBalance(db, userId, result.balance);
	} catch (err) {
		console.error('recordBalance failed after a successful exterior render:', err);
	}
	try {
		const credit = await recordGeneration(db, userId, {
			resultMediaId: outputMedia.id,
			sourceMediaId: sourceMedia.id,
			sessionId: parsed.data.sessionId,
			prompt: parsed.data.prompt,
			kind: 'render',
			amount: result.cost,
			archaiRenderSec: result.renderSec,
			archaiDownloadSec: result.downloadSec,
			archaiReuploadSec: result.reuploadSec,
			formSnapshot: parsed.data.formSnapshot
		});
		generationId = credit.id;
		result = { ...result, balance: credit.balance };
	} catch (err) {
		console.error('recordGeneration failed after a successful exterior render:', err);
		// Even on failure, never fall through to archAI's raw (shared) balance.
		// Prefer a fresh read; if that also fails, fall back to the balance we
		// already had from the precheck — still an approved-account balance,
		// never the shared one.
		const fallback = await getCredit(db, userId).catch((err) => {
			console.error('getCredit fallback failed after a successful exterior render:', err);
			return null;
		});
		result = { ...result, balance: fallback?.balance ?? precheckBalance ?? 0 };
	}

	const output = mediaAccess(outputMedia);
	return json({
		...(generationId !== undefined ? { id: generationId } : {}),
		output,
		cost: result.cost,
		balance: result.balance
	} satisfies RenderResponse);
};
