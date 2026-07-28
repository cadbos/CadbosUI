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

import { createComfyUiClient } from '$lib/server/comfyui/client';
import { ComfyUiError, type ComfyUiClient, type ComfyUiErrorCode } from '$lib/server/comfyui/types';

const COMFYUI_VPC_TARGET_URL = 'http://localhost:8188/';
const COMFYUI_HEALTH_TIMEOUT_MS = 3_000;

function createClient(platform: App.Platform | undefined): ComfyUiClient {
	const vpcService = platform?.env?.COMFYUI_BASE_URL;
	if (!vpcService) {
		throw new ComfyUiError(
			'invalid_configuration',
			'configuration',
			'ComfyUI VPC service not configured'
		);
	}
	return createComfyUiClient({
		baseUrl: COMFYUI_VPC_TARGET_URL,
		fetch: vpcService.fetch.bind(vpcService) as unknown as typeof fetch
	});
}

function healthError(error: unknown): ComfyUiError {
	if (error instanceof ComfyUiError && error.operation === 'health_check') return error;
	const code: ComfyUiErrorCode =
		error instanceof ComfyUiError && error.code === 'invalid_configuration'
			? 'invalid_configuration'
			: 'network_error';
	return new ComfyUiError(code, 'health_check', 'Custom workflow service unavailable', {
		cause: error
	});
}

function logHealthFailure(error: unknown): void {
	const detail =
		error instanceof ComfyUiError
			? {
					providerCode: error.code,
					providerOperation: error.operation,
					...(error.status === undefined ? {} : { providerStatus: error.status })
				}
			: { providerCode: 'unknown' };
	console.warn(
		JSON.stringify({
			level: 'warn',
			area: 'custom-workflows',
			event: 'health_check_failed',
			...detail
		})
	);
}

export function getComfyUiClient(platform: App.Platform | undefined): ComfyUiClient {
	return createClient(platform);
}

export async function requireHealthyComfyUiClient(
	platform: App.Platform | undefined
): Promise<ComfyUiClient> {
	try {
		const client = createClient(platform);
		await client.checkHealth({ signal: AbortSignal.timeout(COMFYUI_HEALTH_TIMEOUT_MS) });
		return client;
	} catch (error) {
		throw healthError(error);
	}
}

export async function customWorkflowsAvailable(
	platform: App.Platform | undefined
): Promise<boolean> {
	try {
		await requireHealthyComfyUiClient(platform);
		return true;
	} catch (error) {
		logHealthFailure(error);
		return false;
	}
}
