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
import { objectScaleDrawRect } from './image-scale';

describe('objectScaleDrawRect', () => {
	it('draws at full size with no offset when scale is 1', () => {
		expect(objectScaleDrawRect(200, 100, 1)).toEqual({ dx: 0, dy: 0, dw: 200, dh: 100 });
	});

	it('centers a smaller draw rect, padding the margin, when scale < 1', () => {
		expect(objectScaleDrawRect(200, 100, 0.5)).toEqual({ dx: 50, dy: 25, dw: 100, dh: 50 });
	});

	it('centers a larger draw rect, overflowing for the canvas to clip, when scale > 1', () => {
		expect(objectScaleDrawRect(200, 100, 2)).toEqual({ dx: -100, dy: -50, dw: 400, dh: 200 });
	});
});
