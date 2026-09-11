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
import type { ProModeJobResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { ComfyUiError } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { imageExtensionFromMime } from '$lib/image-mime';
import { getBucketByName, getOrCreateMediaByKey, uploadsBucketName } from '$lib/server/media';
import { mediaAccessById } from '$lib/server/media-access';
import { PRO_MODE_TIMEOUT_MS, pollProMode } from '$lib/server/pro-mode';
import {
	completeProModeJob,
	failProModeJob,
	getProModeJob,
	type ProModeJob
} from '$lib/server/pro-mode-jobs';
import { uploadGeneratedImageBytes } from '$lib/server/uploads';

async function responseForJob(
	job: ProModeJob,
	db: ReturnType<typeof getDb>,
	platform: App.Platform | undefined
): Promise<Response> {
	const headers = { 'cache-control': 'no-store' };
	if (job.status === 'processing') {
		return json({ id: job.id, status: job.status } satisfies ProModeJobResponse, {
			headers: { ...headers, 'retry-after': '2' }
		});
	}
	if (job.status === 'completed' && job.outputMediaId !== null && job.balanceAfter !== null) {
		const output = await mediaAccessById(db, platform, job.outputMediaId);
		if (!output) return apiError(404, 'pro_mode_not_found', 'Pro mode job not found');
		return json(
			{
				id: job.id,
				status: job.status,
				output,
				cost: job.cost,
				balance: job.balanceAfter
			} satisfies ProModeJobResponse,
			{ headers }
		);
	}
	const timedOut = job.errorCode === 'pro_mode_timeout';
	return json(
		{
			id: job.id,
			status: 'failed',
			error: {
				code: job.errorCode ?? 'pro_mode_failed',
				message: timedOut ? 'Pro mode timed out' : 'Pro mode failed'
			}
		} satisfies ProModeJobResponse,
		{ headers }
	);
}

export const GET: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) {
		return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	}
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');
	let job = await getProModeJob(db, userId, params.id);
	if (!job) return apiError(404, 'pro_mode_not_found', 'Pro mode job not found');
	if (job.status !== 'processing') return responseForJob(job, db, platform);

	let result;
	try {
		result = await pollProMode(platform, job.comfyPromptId);
	} catch (error) {
		if (
			error instanceof ComfyUiError &&
			(error.code === 'execution_failed' || error.code === 'missing_output')
		) {
			job = await failProModeJob(db, userId, job.id, 'pro_mode_failed', Date.now());
			return responseForJob(job, db, platform);
		}
		if (error instanceof ComfyUiError) {
			console.error('ComfyUI pro mode poll failed:', {
				code: error.code,
				operation: error.operation,
				status: error.status
			});
			if (error.code === 'invalid_configuration') {
				return apiError(500, 'pro_mode_poll_failed', 'Pro mode status failed');
			}
		} else {
			console.error('Pro mode poll failed:', error);
		}
		return apiError(502, 'pro_mode_poll_failed', 'Pro mode status failed');
	}

	if (result === null) {
		const now = Date.now();
		if (now - job.createdAt >= PRO_MODE_TIMEOUT_MS) {
			job = await failProModeJob(db, userId, job.id, 'pro_mode_timeout', now);
		}
		return responseForJob(job, db, platform);
	}

	const extension = imageExtensionFromMime(result.contentType);
	if (extension === null) {
		job = await failProModeJob(db, userId, job.id, 'pro_mode_failed', Date.now());
		return responseForJob(job, db, platform);
	}

	try {
		const uploadsBucket = await getBucketByName(db, uploadsBucketName(platform));
		const stored = await uploadGeneratedImageBytes(
			platform,
			uploadsBucket,
			result.bytes,
			result.contentType,
			`pro-mode/${job.id}.${extension}`
		);
		const output = await getOrCreateMediaByKey(db, uploadsBucket, stored.key, stored.hash);
		job = await completeProModeJob(db, userId, job.id, output.id, Date.now());
		return responseForJob(job, db, platform);
	} catch (error) {
		console.error('Pro mode finalization failed:', error);
		return apiError(500, 'pro_mode_finalize_failed', 'Pro mode failed');
	}
};
