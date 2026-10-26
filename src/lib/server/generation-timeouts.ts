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

type TimeoutVariable =
	| 'COMFYUI_JOB_TIMEOUT_MS'
	| 'COMFYUI_REQUEST_TIMEOUT_MS'
	| 'RENDER_TIMEOUT_MS';

export class GenerationTimeoutConfigurationError extends Error {
	constructor(variable: TimeoutVariable) {
		super(`${variable} is invalid`);
		this.name = 'GenerationTimeoutConfigurationError';
	}
}

function timeout(
	platform: App.Platform | undefined,
	variable: TimeoutVariable,
	fallback: number
): number {
	const value = platform?.env?.[variable];
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
		throw new GenerationTimeoutConfigurationError(variable);
	}
	return parsed;
}

export function comfyUiJobTimeout(platform: App.Platform | undefined): number {
	return timeout(platform, 'COMFYUI_JOB_TIMEOUT_MS', 600_000);
}

export function comfyUiRequestTimeout(platform: App.Platform | undefined): number {
	return timeout(platform, 'COMFYUI_REQUEST_TIMEOUT_MS', 120_000);
}

// The queue position only enriches a job's progress, so its lookup gets a
// few seconds at most rather than the full request budget: a slow /queue
// must never hold the status poll past the client's own request timeout.
const COMFYUI_QUEUE_LOOKUP_TIMEOUT_MS = 5_000;

export function comfyUiQueueLookupTimeout(platform: App.Platform | undefined): number {
	return Math.min(COMFYUI_QUEUE_LOOKUP_TIMEOUT_MS, comfyUiRequestTimeout(platform));
}

export function renderTimeout(platform: App.Platform | undefined): number {
	return timeout(platform, 'RENDER_TIMEOUT_MS', 120_000);
}
