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
import { REPAINT_REGION_MIN_SIZE, repaintRegionSchema } from '$lib/repaint-region';

describe('repaintRegionSchema', () => {
	it('accepts a region inside the scene, including one reaching its edges', () => {
		expect(repaintRegionSchema.safeParse({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }).success).toBe(
			true
		);
		expect(repaintRegionSchema.safeParse({ x: 0, y: 0, width: 1, height: 1 }).success).toBe(true);
	});

	it('tolerates floating-point error at the far edge', () => {
		expect(
			repaintRegionSchema.safeParse({ x: 0.7, y: 0, width: 0.1 + 0.2, height: 1 }).success
		).toBe(true);
	});

	it('rejects a region that sticks out of the scene or starts outside it', () => {
		for (const region of [
			{ x: 0.8, y: 0, width: 0.5, height: 0.5 },
			{ x: 0, y: 0.6, width: 0.5, height: 0.5 },
			{ x: -0.1, y: 0, width: 0.5, height: 0.5 },
			{ x: 1.1, y: 0, width: 0.5, height: 0.5 }
		]) {
			expect(repaintRegionSchema.safeParse(region).success).toBe(false);
		}
	});

	it('rejects a side thinner than the minimum and any unknown field', () => {
		const thin = REPAINT_REGION_MIN_SIZE / 2;
		expect(repaintRegionSchema.safeParse({ x: 0, y: 0, width: thin, height: 0.5 }).success).toBe(
			false
		);
		expect(repaintRegionSchema.safeParse({ x: 0, y: 0, width: 0.5, height: thin }).success).toBe(
			false
		);
		expect(
			repaintRegionSchema.safeParse({ x: 0, y: 0, width: 0.5, height: 0.5, rotation: 1 }).success
		).toBe(false);
	});
});
