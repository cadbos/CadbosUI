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
import type { ObjectAdderJobResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { ComfyUiError } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { imageExtensionFromMime } from '$lib/image-mime';
import { getBucketByName } from '$lib/server/media';
import { OBJECT_ADDER_TIMEOUT_MS, pollObjectAdder } from '$lib/server/object-adder';
import {
	completeObjectAdderJob,
	failObjectAdderJob,
	getObjectAdderJob,
	type ObjectAdderJob
} from '$lib/server/object-adder-jobs';
import { uploadImageBytes } from '$lib/server/uploads';

function responseForJob(job: ObjectAdderJob): Response {
	const headers = { 'cache-control': 'no-store' };
	if (job.status === 'processing') {
		return json({ id: job.id, status: job.status } satisfies ObjectAdderJobResponse, {
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
			} satisfies ObjectAdderJobResponse,
			{ headers }
		);
	}
	const timedOut = job.errorCode === 'object_adder_timeout';
	return json(
		{
			id: job.id,
			status: 'failed',
			error: {
				code: job.errorCode ?? 'object_adder_failed',
				message: timedOut ? 'Object adder timed out' : 'Object adder failed'
			}
		} satisfies ObjectAdderJobResponse,
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
	let job = await getObjectAdderJob(db, userId, params.id);
	if (!job) return apiError(404, 'object_adder_not_found', 'Object adder job not found');
	if (job.status !== 'processing') return responseForJob(job);

	let result;
	try {
		result = await pollObjectAdder(platform, job.comfyPromptId);
	} catch (error) {
		if (
			error instanceof ComfyUiError &&
			(error.code === 'execution_failed' || error.code === 'missing_output')
		) {
			job = await failObjectAdderJob(db, userId, job.id, 'object_adder_failed', Date.now());
			return responseForJob(job);
		}
		if (error instanceof ComfyUiError) {
			console.error('ComfyUI object adder poll failed:', {
				code: error.code,
				operation: error.operation,
				status: error.status
			});
			if (error.code === 'invalid_configuration') {
				return apiError(500, 'object_adder_poll_failed', 'Object adder status failed');
			}
		} else {
			console.error('Object adder poll failed:', error);
		}
		return apiError(502, 'object_adder_poll_failed', 'Object adder status failed');
	}

	if (result === null) {
		const now = Date.now();
		if (now - job.createdAt >= OBJECT_ADDER_TIMEOUT_MS) {
			job = await failObjectAdderJob(db, userId, job.id, 'object_adder_timeout', now);
		}
		return responseForJob(job);
	}

	const extension = imageExtensionFromMime(result.contentType);
	if (extension === null) {
		job = await failObjectAdderJob(db, userId, job.id, 'object_adder_failed', Date.now());
		return responseForJob(job);
	}

	try {
		const uploadsUrl = (await getBucketByName(db, 'cadbos-uploads')).url;
		const stored = await uploadImageBytes(
			platform,
			uploadsUrl,
			result.bytes,
			result.contentType,
			`object-adders/${job.id}.${extension}`
		);
		job = await completeObjectAdderJob(db, userId, job.id, stored.url, stored.hash, Date.now());
		return responseForJob(job);
	} catch (error) {
		console.error('Object adder finalization failed:', error);
		return apiError(500, 'object_adder_finalize_failed', 'Object adder failed');
	}
};
