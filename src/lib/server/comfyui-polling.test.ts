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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { comfyUiPollIntervalSeconds } from './comfyui-polling';

function platform(value?: string): App.Platform {
	return { env: { COMFYUI_POLL_INTERVAL_SECONDS: value } } as App.Platform;
}

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ComfyUI polling interval', () => {
	it('defaults to two seconds without warning when the platform or setting is absent', () => {
		expect(comfyUiPollIntervalSeconds(undefined)).toBe(2);
		expect(comfyUiPollIntervalSeconds(platform())).toBe(2);
		expect(console.warn).not.toHaveBeenCalled();
	});

	it.each(['1', '2', '60', '2147483'])('accepts %s seconds without warning', (value) => {
		expect(comfyUiPollIntervalSeconds(platform(value))).toBe(Number(value));
		expect(console.warn).not.toHaveBeenCalled();
	});

	it.each([
		'',
		' ',
		'0',
		'-1',
		'1.5',
		' 60',
		'60 ',
		'01',
		'+1',
		'1e3',
		'0x10',
		'NaN',
		'Infinity',
		'private-invalid-value',
		'2147484',
		'9007199254740992'
	])('warns and defaults for invalid input %j without exposing or mutating it', (value) => {
		const configured = platform(value);
		expect(comfyUiPollIntervalSeconds(configured)).toBe(2);
		expect(console.warn).toHaveBeenCalledExactlyOnceWith(
			'COMFYUI_POLL_INTERVAL_SECONDS is invalid; using the default of 2 seconds'
		);
		expect(configured.env.COMFYUI_POLL_INTERVAL_SECONDS).toBe(value);
	});

	it('reads changes from the current request platform', () => {
		const configured = platform('60');
		expect(comfyUiPollIntervalSeconds(configured)).toBe(60);
		configured.env.COMFYUI_POLL_INTERVAL_SECONDS = '5';
		expect(comfyUiPollIntervalSeconds(configured)).toBe(5);
		expect(console.warn).not.toHaveBeenCalled();
	});
});
