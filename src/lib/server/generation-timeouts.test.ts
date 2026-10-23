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

import { describe, expect, it } from 'vitest';
import {
	comfyUiJobTimeout,
	comfyUiRequestTimeout,
	renderTimeout,
	GenerationTimeoutConfigurationError
} from './generation-timeouts';

const settings = [
	{ variable: 'COMFYUI_JOB_TIMEOUT_MS', read: comfyUiJobTimeout, fallback: 600_000 },
	{ variable: 'COMFYUI_REQUEST_TIMEOUT_MS', read: comfyUiRequestTimeout, fallback: 120_000 },
	{ variable: 'RENDER_TIMEOUT_MS', read: renderTimeout, fallback: 120_000 }
] as const;

function platform(env: Partial<App.Platform['env']>): App.Platform {
	return { env } as App.Platform;
}

for (const { variable, read, fallback } of settings) {
	describe(variable, () => {
		it('uses the current default when the platform or setting is absent', () => {
			expect(read(undefined)).toBe(fallback);
			expect(read(platform({}))).toBe(fallback);
		});

		it.each(['1', '180000', '2147483647'])('accepts %s milliseconds', (value) => {
			expect(read(platform({ [variable]: value }))).toBe(Number(value));
		});

		it.each([
			'',
			' ',
			'0',
			'-1',
			'1.5',
			' 300',
			'300 ',
			'01',
			'+1',
			'1e3',
			'0x10',
			'NaN',
			'Infinity',
			'invalid',
			'2147483648',
			'9007199254740992'
		])('rejects invalid input %j without exposing its value', (value) => {
			expect(() => read(platform({ [variable]: value }))).toThrow(
				GenerationTimeoutConfigurationError
			);
			expect(() => read(platform({ [variable]: value }))).toThrow(`${variable} is invalid`);
		});
	});
}

it('resolves independent settings from the current request platform', () => {
	const configured = platform({
		COMFYUI_JOB_TIMEOUT_MS: '1800000',
		COMFYUI_REQUEST_TIMEOUT_MS: '90000',
		RENDER_TIMEOUT_MS: '240000'
	});
	expect(comfyUiJobTimeout(configured)).toBe(1_800_000);
	expect(comfyUiRequestTimeout(configured)).toBe(90_000);
	expect(renderTimeout(configured)).toBe(240_000);
	expect(comfyUiJobTimeout(platform({ COMFYUI_REQUEST_TIMEOUT_MS: '90000' }))).toBe(600_000);
	expect(comfyUiRequestTimeout(undefined)).toBe(120_000);
	expect(renderTimeout(undefined)).toBe(120_000);
});
