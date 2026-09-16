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
import type { EditJobResponse } from '$lib/api/contract';
import { apiError, editRequestSchema, parseBody } from '$lib/server/api';
import { getDb } from '$lib/server/db';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { assertGenerationAllowed, getUserIdByPubkey } from '$lib/server/billing';
import { ComfyUiError } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import {
	cancelFluxKontextEdit,
	fluxKontextEditCost,
	submitFluxKontextEdit
} from '$lib/server/flux-kontext-edit';
import { createFluxKontextEditJob } from '$lib/server/flux-kontext-edit-jobs';
import { providerMediaBatch } from '$lib/server/media-access';
import { assertSessionOwnedByUser } from '$lib/server/projects';
import { RemoteImageImportError } from '$lib/server/remote-image';

// Anti-cost-abuse (FR-К5): each edit is its own paid call, so it gets its own
// rate-limit bucket, bound to the authenticated pubkey rather than IP.
const EDIT_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;
const editInFlight = new Set<string>();

function logRejection(status: number, reason: string): void {
	console.warn(
		JSON.stringify({
			level: 'warn',
			area: 'edit',
			event: 'request_rejected',
			status,
			reason
		})
	);
}

interface FailureDetail {
	operation: string;
	providerCode?: string;
	providerOperation?: string;
	providerStatus?: number;
}

function logFailure(status: number, reason: string, detail: FailureDetail): void {
	console.error(
		JSON.stringify({
			level: 'error',
			area: 'edit',
			event: 'request_failed',
			status,
			reason,
			...detail
		})
	);
}

function remoteImageError(error: RemoteImageImportError): Response {
	switch (error.code) {
		case 'invalid_url':
			return apiError(400, error.code, 'Invalid image URL');
		case 'unsupported_image_type':
			return apiError(415, error.code, 'Unsupported image type');
		case 'image_too_large':
			return apiError(413, error.code, 'Image exceeds the 8 MB limit');
		case 'remote_fetch_failed':
			logFailure(502, error.code, { operation: 'remote_image_import' });
			return apiError(502, error.code, 'Failed to fetch image');
	}
}

// Editing is restricted further, by design: only accounts an admin has
// manually approved (a `credits` row, billing.ts) may edit at all — a fresh
// Nostr login alone is not enough (mirrors /api/render). ComfyUI jobs also
// need a real D1 user row, so — unlike the old synchronous archAI-backed
// handler — the dev demo account can't be used here (mirrors
// object-replacement/light-settings).
export const POST: RequestHandler = async ({ request, platform, locals, url }) => {
	if (!locals.user) {
		const response = authenticationRequiredResponse(locals.sessionLookupUnavailable);
		logRejection(
			response.status,
			locals.sessionLookupUnavailable ? 'authentication_unavailable' : 'unauthorized'
		);
		return response;
	}
	const parsed = await parseBody(request, editRequestSchema);
	if (!parsed.ok) return parsed.response;
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		logFailure(500, 'account_error', { operation: 'account_lookup' });
		return apiError(500, 'account_error', 'Account record not found');
	}

	// Concurrent submissions from the same account could both pass the balance
	// check before either job is persisted; a per-pubkey in-flight guard closes
	// that window (mirrors object-replacement/light-settings).
	const pubkey = locals.user.pubkey;
	if (editInFlight.has(pubkey)) {
		logRejection(409, 'request_in_progress');
		return apiError(409, 'request_in_progress', 'Edit request already in progress');
	}
	editInFlight.add(pubkey);

	try {
		const db = getDb(platform);
		const userId = await getUserIdByPubkey(db, pubkey);
		if (!userId) {
			logFailure(500, 'account_error', { operation: 'account_lookup' });
			return apiError(500, 'account_error', 'Account record not found');
		}
		const limited = await touchRateLimit(db, `edit:${pubkey}`, Date.now(), EDIT_RATE_LIMIT);
		if (limited) {
			logRejection(429, 'rate_limited');
			return apiError(429, 'rate_limited', 'Too many requests');
		}

		if (!(await assertSessionOwnedByUser(db, userId, parsed.data.sessionId))) {
			logRejection(404, 'session_not_found');
			return apiError(404, 'session_not_found', 'Session not found');
		}
		const media = await providerMediaBatch(db, platform, [parsed.data.imageKey]);
		if (!media) return apiError(404, 'image_not_found', 'Image not found');
		const sceneMedia = media.get(parsed.data.imageKey)!.media;

		let cost: number;
		try {
			cost = fluxKontextEditCost(platform);
			const check = await assertGenerationAllowed(db, userId);
			if (!check.allowed) {
				if (check.reason === 'not_approved') {
					logRejection(403, 'generation_restricted');
					return apiError(
						403,
						'generation_restricted',
						'Generation is limited to approved accounts'
					);
				}
				logRejection(402, 'insufficient_credit');
				return apiError(402, 'insufficient_credit', 'Test balance exhausted');
			}
			if (check.balance < cost) {
				logRejection(402, 'insufficient_credit');
				return apiError(402, 'insufficient_credit', 'Test balance exhausted');
			}
		} catch {
			logFailure(500, 'edit_failed', { operation: 'billing_precheck' });
			return apiError(500, 'edit_failed', 'Edit failed');
		}

		const id = crypto.randomUUID();
		let comfyPromptId: string;
		try {
			comfyPromptId = await submitFluxKontextEdit(
				platform,
				{ image: media.get(parsed.data.imageKey)!.url, prompt: parsed.data.prompt },
				url.origin,
				id
			);
		} catch (error) {
			if (error instanceof RemoteImageImportError) return remoteImageError(error);
			if (error instanceof ComfyUiError) {
				const detail: FailureDetail = {
					operation: 'provider_submission',
					providerCode: error.code,
					providerOperation: error.operation,
					...(error.status === undefined ? {} : { providerStatus: error.status })
				};
				if (error.code === 'invalid_configuration') {
					logFailure(500, 'edit_failed', detail);
					return apiError(500, 'edit_failed', 'Edit failed');
				}
				logFailure(502, 'edit_failed', detail);
			} else {
				logFailure(502, 'edit_failed', { operation: 'provider_submission' });
			}
			return apiError(502, 'edit_failed', 'Edit failed');
		}

		try {
			await createFluxKontextEditJob(db, {
				id,
				userId,
				comfyPromptId,
				sceneMediaId: sceneMedia.id,
				sessionId: parsed.data.sessionId,
				instruction: parsed.data.prompt,
				cost,
				createdAt: Date.now()
			});
		} catch {
			logFailure(500, 'edit_failed', { operation: 'job_persistence' });
			try {
				await cancelFluxKontextEdit(platform, comfyPromptId);
			} catch (cleanupError) {
				logFailure(
					500,
					'edit_failed',
					cleanupError instanceof ComfyUiError
						? {
								operation: 'job_persistence_cleanup',
								providerCode: cleanupError.code,
								providerOperation: cleanupError.operation,
								...(cleanupError.status === undefined
									? {}
									: { providerStatus: cleanupError.status })
							}
						: { operation: 'job_persistence_cleanup' }
				);
			}
			return apiError(500, 'edit_failed', 'Edit failed');
		}

		return json({ id, status: 'processing' } satisfies EditJobResponse, {
			status: 202,
			headers: {
				'cache-control': 'no-store',
				location: `/api/edit/${id}`
			}
		});
	} finally {
		editInFlight.delete(pubkey);
	}
};
