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
import type { LightSettingsJobResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/db';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { ComfyUiError } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { imageExtensionFromMime } from '$lib/image-mime';
import { getBucketByName } from '$lib/server/media';
import { LIGHT_SETTINGS_TIMEOUT_MS, pollLightSettings } from '$lib/server/light-settings';
import {
	completeLightSettingsJob,
	failLightSettingsJob,
	getLightSettingsJob,
	type LightSettingsJob
} from '$lib/server/light-settings-jobs';
import { uploadImageBytes } from '$lib/server/uploads';

function responseForJob(job: LightSettingsJob): Response {
	const headers = { 'cache-control': 'no-store' };
	if (job.status === 'processing') {
		return json({ id: job.id, status: job.status } satisfies LightSettingsJobResponse, {
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
			} satisfies LightSettingsJobResponse,
			{ headers }
		);
	}
	const timedOut = job.errorCode === 'light_settings_timeout';
	return json(
		{
			id: job.id,
			status: 'failed',
			error: {
				code: job.errorCode ?? 'light_settings_failed',
				message: timedOut ? 'Light settings timed out' : 'Light settings failed'
			}
		} satisfies LightSettingsJobResponse,
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
	let job = await getLightSettingsJob(db, userId, params.id);
	if (!job) return apiError(404, 'light_settings_not_found', 'Light settings job not found');
	if (job.status !== 'processing') return responseForJob(job);

	let result;
	try {
		result = await pollLightSettings(platform, job.comfyPromptId);
	} catch (error) {
		if (
			error instanceof ComfyUiError &&
			(error.code === 'execution_failed' || error.code === 'missing_output')
		) {
			job = await failLightSettingsJob(db, userId, job.id, 'light_settings_failed', Date.now());
			return responseForJob(job);
		}
		if (error instanceof ComfyUiError) {
			console.error('ComfyUI light settings poll failed:', {
				code: error.code,
				operation: error.operation,
				status: error.status
			});
			if (error.code === 'invalid_configuration') {
				return apiError(500, 'light_settings_poll_failed', 'Light settings status failed');
			}
		} else {
			console.error('Light settings poll failed:', error);
		}
		return apiError(502, 'light_settings_poll_failed', 'Light settings status failed');
	}

	if (result === null) {
		const now = Date.now();
		if (now - job.createdAt >= LIGHT_SETTINGS_TIMEOUT_MS) {
			job = await failLightSettingsJob(db, userId, job.id, 'light_settings_timeout', now);
		}
		return responseForJob(job);
	}

	const extension = imageExtensionFromMime(result.contentType);
	if (extension === null) {
		job = await failLightSettingsJob(db, userId, job.id, 'light_settings_failed', Date.now());
		return responseForJob(job);
	}

	try {
		const uploadsUrl = (await getBucketByName(db, 'cadbos-uploads')).url;
		const stored = await uploadImageBytes(
			platform,
			uploadsUrl,
			result.bytes,
			result.contentType,
			`light-settings/${job.id}.${extension}`
		);
		job = await completeLightSettingsJob(db, userId, job.id, stored.url, stored.hash, Date.now());
		return responseForJob(job);
	} catch (error) {
		console.error('Light settings finalization failed:', error);
		return apiError(500, 'light_settings_finalize_failed', 'Light settings failed');
	}
};
