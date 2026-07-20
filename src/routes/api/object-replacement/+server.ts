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
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { assertGenerationAllowed, getUserIdByPubkey } from '$lib/server/billing';
import { ComfyUiError } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { objectReplacementCost, submitObjectReplacement } from '$lib/server/object-replacement';
import { createObjectReplacementJob } from '$lib/server/object-replacement-jobs';
import { RemoteImageImportError } from '$lib/server/remote-image';

const OBJECT_REPLACEMENT_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;

function remoteImageError(error: RemoteImageImportError): Response {
	switch (error.code) {
		case 'invalid_url':
			return apiError(400, error.code, 'Invalid image URL');
		case 'unsupported_image_type':
			return apiError(415, error.code, 'Unsupported image type');
		case 'image_too_large':
			return apiError(413, error.code, 'Image exceeds the 8 MB limit');
		case 'remote_fetch_failed':
			return apiError(502, error.code, 'Failed to fetch image');
	}
}

export const POST: RequestHandler = async ({ request, platform, locals, url }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	const parsed = await parseBody(request, objectReplacementRequestSchema);
	if (!parsed.ok) return parsed.response;
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');
	const limited = await touchRateLimit(
		db,
		`object-replacement:${locals.user.pubkey}`,
		Date.now(),
		OBJECT_REPLACEMENT_RATE_LIMIT
	);
	if (limited) return apiError(429, 'rate_limited', 'Too many requests');

	let cost: number;
	try {
		cost = objectReplacementCost(platform);
		const check = await assertGenerationAllowed(db, userId);
		if (!check.allowed) {
			return check.reason === 'not_approved'
				? apiError(403, 'generation_restricted', 'Generation is limited to approved accounts')
				: apiError(402, 'insufficient_credit', 'Test balance exhausted');
		}
		if (check.balance < cost) {
			return apiError(402, 'insufficient_credit', 'Test balance exhausted');
		}
	} catch (error) {
		console.error('Object replacement pre-check failed:', error);
		return apiError(500, 'object_replacement_failed', 'Object replacement failed');
	}

	const id = crypto.randomUUID();
	let comfyPromptId: string;
	try {
		comfyPromptId = await submitObjectReplacement(platform, parsed.data, url.origin, id);
	} catch (error) {
		if (error instanceof RemoteImageImportError) return remoteImageError(error);
		if (error instanceof ComfyUiError) {
			console.error('ComfyUI object replacement submission failed:', {
				code: error.code,
				operation: error.operation,
				status: error.status
			});
			if (error.code === 'invalid_configuration') {
				return apiError(500, 'object_replacement_failed', 'Object replacement failed');
			}
		} else {
			console.error('Object replacement submission failed:', error);
		}
		return apiError(502, 'object_replacement_failed', 'Object replacement failed');
	}

	try {
		await createObjectReplacementJob(db, {
			id,
			userId,
			comfyPromptId,
			sceneUrl: parsed.data.image,
			referenceUrl: parsed.data.referenceImage,
			replacementObject: parsed.data.replacementObject,
			cost,
			createdAt: Date.now()
		});
	} catch (error) {
		console.error('Object replacement job persistence failed:', error);
		return apiError(500, 'object_replacement_failed', 'Object replacement failed');
	}

	return json({ id, status: 'processing' } satisfies ObjectReplacementJobResponse, {
		status: 202,
		headers: {
			'cache-control': 'no-store',
			location: `/api/object-replacement/${id}`
		}
	});
};
