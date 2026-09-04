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
import type { ObjectReplacementJobResponse } from '$lib/api/contract';
import { apiError, objectReplacementRequestSchema, parseBody } from '$lib/server/api';
import { getDb } from '$lib/server/db';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { assertGenerationAllowed, getUserIdByPubkey } from '$lib/server/billing';
import { ComfyUiError } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import {
	cancelObjectReplacement,
	objectReplacementCost,
	submitObjectReplacement
} from '$lib/server/object-replacement';
import { createObjectReplacementJob } from '$lib/server/object-replacement-jobs';
import { assertSessionOwnedByUser } from '$lib/server/projects';
import { RemoteImageImportError } from '$lib/server/remote-image';

const OBJECT_REPLACEMENT_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;
const objectReplacementInFlight = new Set<string>();

function logRejection(status: number, reason: string): void {
	console.warn(
		JSON.stringify({
			level: 'warn',
			area: 'object-replacement',
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
			area: 'object-replacement',
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

export const POST: RequestHandler = async ({ request, platform, locals, url }) => {
	if (!locals.user) {
		const response = authenticationRequiredResponse(locals.sessionLookupUnavailable);
		logRejection(
			response.status,
			locals.sessionLookupUnavailable ? 'authentication_unavailable' : 'unauthorized'
		);
		return response;
	}
	const parsed = await parseBody(request, objectReplacementRequestSchema);
	if (!parsed.ok) return parsed.response;
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		logFailure(500, 'account_error', { operation: 'account_lookup' });
		return apiError(500, 'account_error', 'Account record not found');
	}

	// Concurrent submissions from the same account could both pass the balance
	// check before either job is persisted; a per-pubkey in-flight guard closes
	// that window (mirrors texture-replacement's guard).
	const pubkey = locals.user.pubkey;
	if (objectReplacementInFlight.has(pubkey)) {
		logRejection(409, 'request_in_progress');
		return apiError(409, 'request_in_progress', 'Object replacement request already in progress');
	}
	objectReplacementInFlight.add(pubkey);

	try {
		const db = getDb(platform);
		const userId = await getUserIdByPubkey(db, pubkey);
		if (!userId) {
			logFailure(500, 'account_error', { operation: 'account_lookup' });
			return apiError(500, 'account_error', 'Account record not found');
		}
		const limited = await touchRateLimit(
			db,
			`object-replacement:${pubkey}`,
			Date.now(),
			OBJECT_REPLACEMENT_RATE_LIMIT
		);
		if (limited) {
			logRejection(429, 'rate_limited');
			return apiError(429, 'rate_limited', 'Too many requests');
		}

		if (!(await assertSessionOwnedByUser(db, userId, parsed.data.sessionId))) {
			logRejection(404, 'session_not_found');
			return apiError(404, 'session_not_found', 'Session not found');
		}

		let cost: number;
		try {
			cost = objectReplacementCost(platform);
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
			logFailure(500, 'object_replacement_failed', { operation: 'billing_precheck' });
			return apiError(500, 'object_replacement_failed', 'Object replacement failed');
		}

		const id = crypto.randomUUID();
		let comfyPromptId: string;
		try {
			comfyPromptId = await submitObjectReplacement(platform, parsed.data, url.origin, id);
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
					logFailure(500, 'object_replacement_failed', detail);
					return apiError(500, 'object_replacement_failed', 'Object replacement failed');
				}
				logFailure(502, 'object_replacement_failed', detail);
			} else {
				logFailure(502, 'object_replacement_failed', { operation: 'provider_submission' });
			}
			return apiError(502, 'object_replacement_failed', 'Object replacement failed');
		}

		try {
			await createObjectReplacementJob(db, {
				id,
				userId,
				comfyPromptId,
				sceneUrl: parsed.data.image,
				sceneHash: parsed.data.imageHash ?? '',
				sessionId: parsed.data.sessionId,
				referenceUrl: parsed.data.referenceImage,
				replacementObject: parsed.data.replacementObject,
				cost,
				createdAt: Date.now()
			});
		} catch {
			logFailure(500, 'object_replacement_failed', { operation: 'job_persistence' });
			try {
				await cancelObjectReplacement(platform, comfyPromptId);
			} catch (cleanupError) {
				logFailure(
					500,
					'object_replacement_failed',
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
			return apiError(500, 'object_replacement_failed', 'Object replacement failed');
		}

		return json({ id, status: 'processing' } satisfies ObjectReplacementJobResponse, {
			status: 202,
			headers: {
				'cache-control': 'no-store',
				location: `/api/object-replacement/${id}`
			}
		});
	} finally {
		objectReplacementInFlight.delete(pubkey);
	}
};
