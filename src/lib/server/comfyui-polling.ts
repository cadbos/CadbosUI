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

import { z } from 'zod';

const DEFAULT_POLL_INTERVAL_SECONDS = 2;
const pollIntervalSecondsSchema = z
	.string()
	.regex(/^[1-9]\d*$/)
	.pipe(z.coerce.number<string>().int().min(1).max(2_147_483));

export function comfyUiPollIntervalSeconds(platform: App.Platform | undefined): number {
	const value = platform?.env?.COMFYUI_POLL_INTERVAL_SECONDS;
	if (value === undefined) return DEFAULT_POLL_INTERVAL_SECONDS;
	const parsed = pollIntervalSecondsSchema.safeParse(value);
	if (!parsed.success) {
		console.warn('COMFYUI_POLL_INTERVAL_SECONDS is invalid; using the default of 2 seconds');
		return DEFAULT_POLL_INTERVAL_SECONDS;
	}
	return parsed.data;
}
