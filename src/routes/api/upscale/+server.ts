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
import { apiError, parseBody, upscaleRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { upscale4k } from '$lib/server/generation';
import { runPaidGeneration } from '$lib/server/paid-generation';

// Anti-cost-abuse: each upscale is its own paid call, mirroring /api/edit — its
// own rate-limit bucket, bound to the authenticated pubkey rather than IP.
const UPSCALE_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;

// Session is enforced centrally in hooks.server.ts (guardedPaths). Upscaling
// itself is restricted further, by design: only accounts an admin has enabled
// in `generation_access` may upscale at all — a fresh Nostr
// login alone is not enough (mirrors /api/render and /api/edit).
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, upscaleRequestSchema);
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
			`upscale:${locals.user.pubkey}`,
			Date.now(),
			UPSCALE_RATE_LIMIT
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
					prompt: '4k upscale',
					kind: 'upscale'
				},
				() => upscale4k(platform, parsed.data)
			);
			if (!result.allowed) {
				return result.reason === 'not_approved'
					? apiError(403, 'generation_restricted', 'Generation is limited to approved accounts')
					: apiError(402, 'insufficient_credit', 'Test balance exhausted');
			}
			return json(result.response);
		}
		return json(await upscale4k(platform, parsed.data));
	} catch (err) {
		console.error('upscale operation failed:', err);
		return apiError(500, 'upscale_failed', 'Upscale failed');
	}
};
