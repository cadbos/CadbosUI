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

import { fluxKontextEditCost } from './flux-kontext-edit';
import { lightSettingsCost } from './light-settings';
import { objectReplacementCost } from './object-replacement';
import { repaintCost } from './repaint';
import { textureReplacementCost } from './texture-replacement';

function platform(env: Partial<App.Platform['env']>): App.Platform {
	return { env } as App.Platform;
}

describe.each([
	['OBJECT_REPLACEMENT_COST', objectReplacementCost],
	['TEXTURE_REPLACEMENT_COST', textureReplacementCost],
	['LIGHT_SETTINGS_COST', lightSettingsCost],
	['FLUX_KONTEXT_EDIT_COST', fluxKontextEditCost],
	['REPAINT_COST', repaintCost]
] as const)('%s configuration', (key, cost) => {
	it.each(['0', ' 0 ', '0.001', '3.5'])('accepts nonnegative cost %s', (value) => {
		expect(cost(platform({ [key]: value }))).toBe(Number(value));
	});

	it.each(['-1', 'NaN', 'Infinity', '-Infinity', 'free'])('rejects invalid cost %s', (value) => {
		expect(() => cost(platform({ [key]: value }))).toThrow('Invalid');
	});
});
