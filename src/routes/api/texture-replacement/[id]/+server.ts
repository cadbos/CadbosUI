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
import type { TextureReplacementJobResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getUserIdByPubkey } from '$lib/server/billing';
import { ComfyUiError } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { imageExtensionFromMime } from '$lib/server/image-utils';
import {
	pollTextureReplacement,
	TEXTURE_REPLACEMENT_TIMEOUT_MS
} from '$lib/server/texture-replacement';
import {
	completeTextureReplacementJob,
	failTextureReplacementJob,
	getTextureReplacementJob,
	type TextureReplacementJob
} from '$lib/server/texture-replacement-jobs';
import { uploadImageBytes } from '$lib/server/uploads';

function responseForJob(job: TextureReplacementJob): Response {
	const headers = { 'cache-control': 'no-store' };
	if (job.status === 'processing') {
		return json({ id: job.id, status: job.status } satisfies TextureReplacementJobResponse, {
			headers: { ...headers, 'retry-after': '2' }
		});
	}
	if (job.status === 'completed' && job.outputUrl !== null && job.balanceAfter !== null) {
		return json(
			{
				id: job.id,
				status: job.status,
				outputUrl: job.outputUrl,
				cost: job.cost,
				balance: job.balanceAfter
			} satisfies TextureReplacementJobResponse,
			{ headers }
		);
	}
	const timedOut = job.errorCode === 'texture_replacement_timeout';
	return json(
		{
			id: job.id,
			status: 'failed',
			error: {
				code: job.errorCode ?? 'texture_replacement_failed',
				message: timedOut ? 'Texture replacement timed out' : 'Texture replacement failed'
			}
		} satisfies TextureReplacementJobResponse,
		{ headers }
	);
}

export const GET: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');
	let job = await getTextureReplacementJob(db, userId, params.id);
	if (!job) return apiError(404, 'texture_replacement_not_found', 'Texture replacement not found');
	if (job.status !== 'processing') return responseForJob(job);

	let result;
	try {
		result = await pollTextureReplacement(platform, job.comfyPromptId);
	} catch (error) {
		if (
			error instanceof ComfyUiError &&
			(error.code === 'execution_failed' || error.code === 'missing_output')
		) {
			job = await failTextureReplacementJob(
				db,
				userId,
				job.id,
				'texture_replacement_failed',
				Date.now()
			);
			return responseForJob(job);
		}
		if (error instanceof ComfyUiError) {
			console.error('ComfyUI texture replacement poll failed:', {
				code: error.code,
				operation: error.operation,
				status: error.status
			});
			if (error.code === 'invalid_configuration') {
				return apiError(
					500,
					'texture_replacement_poll_failed',
					'Texture replacement status failed'
				);
			}
		} else {
			console.error('Texture replacement poll failed:', error);
		}
		return apiError(502, 'texture_replacement_poll_failed', 'Texture replacement status failed');
	}

	if (result === null) {
		const now = Date.now();
		if (now - job.createdAt >= TEXTURE_REPLACEMENT_TIMEOUT_MS) {
			job = await failTextureReplacementJob(db, userId, job.id, 'texture_replacement_timeout', now);
		}
		return responseForJob(job);
	}

	const extension = imageExtensionFromMime(result.contentType);
	if (extension === null) {
		job = await failTextureReplacementJob(
			db,
			userId,
			job.id,
			'texture_replacement_failed',
			Date.now()
		);
		return responseForJob(job);
	}

	try {
		const stored = await uploadImageBytes(
			platform,
			result.bytes,
			result.contentType,
			`texture-replacements/${job.id}.${extension}`
		);
		job = await completeTextureReplacementJob(db, userId, job.id, stored.url, Date.now());
		return responseForJob(job);
	} catch (error) {
		console.error('Texture replacement finalization failed:', error);
		return apiError(500, 'texture_replacement_finalize_failed', 'Texture replacement failed');
	}
};
