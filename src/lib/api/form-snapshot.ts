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
import { EDIT_OPERATION_TYPES, SCENE_TYPES, type RequestFormSnapshot } from '$lib/api/contract';
import { photoAdjustmentsSchema } from '$lib/photo-adjustments';
import { imageRegionSchema } from '$lib/image-region';
import { DEFAULT_REPAINT_COLOR, REPAINT_COLOR_PATTERN } from '$lib/repaint-colors';

const formSnapshotPromptFragment = z.object({
	id: z.string().min(1),
	label: z.string().optional(),
	text: z.string(),
	order: z.number().int().nonnegative()
});

const formSnapshotImage = z.union([
	z.object({
		mediaKey: z.string().min(1),
		mime: z.string().min(1).optional(),
		size: z.number().nonnegative().optional(),
		dimensions: z.tuple([z.number().positive(), z.number().positive()]).optional()
	}),
	z.object({
		stylePresetId: z.string().min(1),
		url: z.string().trim().url(),
		mime: z.string().min(1).optional()
	})
]);

export const formSnapshotSchema = z.object({
	photoAdjustments: photoAdjustmentsSchema.optional(),
	promptFragments: z.array(formSnapshotPromptFragment).max(200),
	promptOverride: z.string().nullable(),
	autoEnhance: z.boolean().default(false),
	editPrompt: z.string(),
	addObjectInstruction: z.string().max(500).default(''),
	removeObjectText: z.string(),
	editOperationType: z.enum(EDIT_OPERATION_TYPES).nullable().default(null),
	outputFormat: z.enum(['webp', 'jpg', 'png', 'avif']),
	sceneType: z.enum(SCENE_TYPES),
	styleTransferPrompt: z.string(),
	styleTransferStrength: z.number().min(0).max(1),
	styleNegativePrompt: z.string(),
	styleReferenceImage: formSnapshotImage.optional(),
	objectReplacementObject: z.string().max(200),
	objectReplacementScale: z.number().min(0.5).max(2),
	objectReplacementRegion: imageRegionSchema.nullable().default(null),
	objectReferenceImage: formSnapshotImage.optional(),
	textureReplacementSurface: z.string().max(200),
	textureReplacementMasked: z.boolean(),
	textureReferenceImage: formSnapshotImage.optional(),
	textureMaskImage: formSnapshotImage.optional(),
	textureMaskSourceKey: z.string().min(1).optional(),
	lightSettingsPresetIds: z.array(z.string()).max(50),
	lightSettingsInstruction: z.string().max(500),
	repaintTarget: z.string().max(200).default(''),
	repaintColor: z.string().regex(REPAINT_COLOR_PATTERN).default(DEFAULT_REPAINT_COLOR),
	repaintRegion: imageRegionSchema.nullable().default(null)
}) satisfies z.ZodType<RequestFormSnapshot>;
