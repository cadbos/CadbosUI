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

// The smallest side of a repaint region, as a fraction of the scene's side.
// Anything thinner cannot hold an object the segmenter could find.
export const REPAINT_REGION_MIN_SIZE = 0.02;

// Tolerance for the fractions' floating-point sums reaching the scene's edge.
const EDGE_TOLERANCE = 1e-6;

// The part of the scene the repaint is confined to, as fractions of the
// scene's width and height measured from its top-left corner. Fractions keep
// the region independent of the resolution the scene is stored or processed at.
export const repaintRegionSchema = z
	.strictObject({
		x: z.number().min(0).max(1),
		y: z.number().min(0).max(1),
		width: z.number().min(REPAINT_REGION_MIN_SIZE).max(1),
		height: z.number().min(REPAINT_REGION_MIN_SIZE).max(1)
	})
	.refine(
		(region) =>
			region.x + region.width <= 1 + EDGE_TOLERANCE &&
			region.y + region.height <= 1 + EDGE_TOLERANCE,
		{ message: 'Region extends beyond the scene' }
	);

export type RepaintRegion = z.infer<typeof repaintRegionSchema>;
