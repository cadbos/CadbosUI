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

import {
	ComfyUiError,
	createComfyUiClient,
	getLightSettingsResult,
	queueLightSettings,
	type ComfyDownloadedImage
} from '$lib/server/comfyui';
import { imageExtensionFromMime } from '$lib/image-mime';
import { downloadRemoteImage } from '$lib/server/remote-image';

const DEFAULT_LIGHT_SETTINGS_COST = 0.03;
const COMFYUI_REQUEST_TIMEOUT_MS = 120_000;
export const LIGHT_SETTINGS_TIMEOUT_MS = 10 * 60_000;

// Target of the COMFYUI_BASE_URL VPC Service binding (wrangler.jsonc), which
// routes to ComfyUI's actual localhost:8188 on the VPS over the private tunnel.
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
		// Fetcher.fetch is structurally identical to the DOM fetch signature at
		// runtime; only its Request/RequestInfo types (from workers-types, with
		// added `cf`/`fetcher` properties) are nominally distinct from DOM's.
		fetch: vpcService.fetch.bind(vpcService) as unknown as typeof fetch
	});
}

export function lightSettingsCost(platform: App.Platform | undefined): number {
	const configured = platform?.env?.LIGHT_SETTINGS_COST?.trim();
	if (!configured) return DEFAULT_LIGHT_SETTINGS_COST;
	const cost = Number(configured);
	if (!Number.isFinite(cost) || cost <= 0) {
		throw new ComfyUiError('invalid_configuration', 'configuration', 'Invalid light settings cost');
	}
	return cost;
}

export async function cancelLightSettings(
	platform: App.Platform | undefined,
	promptId: string
): Promise<void> {
	await createClient(platform).cancelWorkflow(promptId, {
		signal: AbortSignal.timeout(COMFYUI_REQUEST_TIMEOUT_MS)
	});
}

export async function submitLightSettings(
	platform: App.Platform | undefined,
	request: { image: string; instruction: string },
	applicationOrigin: string,
	jobId: string
): Promise<string> {
	const client = createClient(platform);
	const scene = await downloadRemoteImage(request.image, applicationOrigin);
	const signal = AbortSignal.timeout(COMFYUI_REQUEST_TIMEOUT_MS);
	const queued = await queueLightSettings(client, {
		clientId: jobId,
		instruction: request.instruction,
		scene: {
			data: new Blob([scene.bytes], { type: scene.mime }),
			filename: `${jobId}-scene.${imageExtensionFromMime(scene.mime)}`
		},
		signal
	});
	return queued.promptId;
}

export async function pollLightSettings(
	platform: App.Platform | undefined,
	promptId: string
): Promise<ComfyDownloadedImage | null> {
	return getLightSettingsResult(
		createClient(platform),
		promptId,
		AbortSignal.timeout(COMFYUI_REQUEST_TIMEOUT_MS)
	);
}
