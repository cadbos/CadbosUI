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

import type { ColorReplacementRequest } from '$lib/api/contract';
import {
	ComfyUiError,
	createComfyUiClient,
	getColorReplacementResult,
	queueColorReplacement,
	type ComfyDownloadedImage
} from '$lib/server/comfyui';
import { imageExtensionFromMime } from '$lib/server/image-utils';
import { downloadRemoteImage } from '$lib/server/remote-image';

const DEFAULT_COLOR_REPLACEMENT_COST = 0.03;
const COMFYUI_REQUEST_TIMEOUT_MS = 120_000;
export const COLOR_REPLACEMENT_TIMEOUT_MS = 10 * 60_000;
const COMFYUI_VPC_TARGET_URL = 'http://localhost:8188/';

function createClient(platform: App.Platform | undefined) {
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

export function colorReplacementCost(platform: App.Platform | undefined): number {
	const configured = platform?.env?.COLOR_REPLACEMENT_COST?.trim();
	if (!configured) return DEFAULT_COLOR_REPLACEMENT_COST;
	const cost = Number(configured);
	if (!Number.isFinite(cost) || cost <= 0) {
		throw new ComfyUiError(
			'invalid_configuration',
			'configuration',
			'Invalid color replacement cost'
		);
	}
	return cost;
}

export async function cancelColorReplacement(
	platform: App.Platform | undefined,
	promptId: string
): Promise<void> {
	await createClient(platform).cancelWorkflow(promptId, {
		signal: AbortSignal.timeout(COMFYUI_REQUEST_TIMEOUT_MS)
	});
}

export async function submitColorReplacement(
	platform: App.Platform | undefined,
	request: ColorReplacementRequest,
	applicationOrigin: string,
	jobId: string
): Promise<string> {
	const client = createClient(platform);
	const scene = await downloadRemoteImage(request.image, applicationOrigin);
	const signal = AbortSignal.timeout(COMFYUI_REQUEST_TIMEOUT_MS);
	const queued = await queueColorReplacement(client, {
		clientId: jobId,
		color: request.color,
		scene: {
			data: new Blob([scene.bytes], { type: scene.mime }),
			filename: `${jobId}-scene.${imageExtensionFromMime(scene.mime)}`
		},
		targetObject: request.targetObject,
		signal
	});
	return queued.promptId;
}

export async function pollColorReplacement(
	platform: App.Platform | undefined,
	promptId: string
): Promise<ComfyDownloadedImage | null> {
	return getColorReplacementResult(
		createClient(platform),
		promptId,
		AbortSignal.timeout(COMFYUI_REQUEST_TIMEOUT_MS)
	);
}
