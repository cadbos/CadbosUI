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

import type { TextureReplacementRequest } from '$lib/api/contract';
import {
	ComfyUiError,
	createComfyUiClient,
	getTextureReplacementResult,
	queueTextureReplacement,
	type ComfyDownloadedImage
} from '$lib/server/comfyui';
import { imageExtensionFromMime } from '$lib/server/image-utils';
import { downloadRemoteImage } from '$lib/server/remote-image';

const DEFAULT_TEXTURE_REPLACEMENT_COST = 0.03;
const COMFYUI_REQUEST_TIMEOUT_MS = 120_000;
export const TEXTURE_REPLACEMENT_TIMEOUT_MS = 10 * 60_000;

function createClient(platform: App.Platform | undefined) {
	const baseUrl = platform?.env?.COMFYUI_BASE_URL?.trim();
	if (!baseUrl) {
		throw new ComfyUiError(
			'invalid_configuration',
			'configuration',
			'ComfyUI base URL not configured'
		);
	}
	return createComfyUiClient({ baseUrl });
}

export function textureReplacementCost(platform: App.Platform | undefined): number {
	const configured = platform?.env?.TEXTURE_REPLACEMENT_COST?.trim();
	if (!configured) return DEFAULT_TEXTURE_REPLACEMENT_COST;
	const cost = Number(configured);
	if (!Number.isFinite(cost) || cost <= 0) {
		throw new ComfyUiError(
			'invalid_configuration',
			'configuration',
			'Invalid texture replacement cost'
		);
	}
	return cost;
}

export async function submitTextureReplacement(
	platform: App.Platform | undefined,
	request: TextureReplacementRequest,
	applicationOrigin: string,
	jobId: string
): Promise<string> {
	const client = createClient(platform);
	const [scene, reference] = await Promise.all([
		downloadRemoteImage(request.image, applicationOrigin),
		downloadRemoteImage(request.referenceImage, applicationOrigin)
	]);
	const signal = AbortSignal.timeout(COMFYUI_REQUEST_TIMEOUT_MS);
	const queued = await queueTextureReplacement(client, {
		clientId: jobId,
		reference: {
			data: new Blob([reference.bytes], { type: reference.mime }),
			filename: `${jobId}-reference.${imageExtensionFromMime(reference.mime)}`
		},
		replacementSurface: request.replacementSurface,
		scene: {
			data: new Blob([scene.bytes], { type: scene.mime }),
			filename: `${jobId}-scene.${imageExtensionFromMime(scene.mime)}`
		},
		signal
	});
	return queued.promptId;
}

export async function pollTextureReplacement(
	platform: App.Platform | undefined,
	promptId: string
): Promise<ComfyDownloadedImage | null> {
	return getTextureReplacementResult(
		createClient(platform),
		promptId,
		AbortSignal.timeout(COMFYUI_REQUEST_TIMEOUT_MS)
	);
}
