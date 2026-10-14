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

const signedAdjustment = z.number().int().min(-100).max(100);
const positiveAdjustment = z.number().int().min(0).max(100);

export const photoAdjustmentsSchema = z.strictObject({
	exposure: signedAdjustment,
	contrast: signedAdjustment,
	highlights: signedAdjustment,
	shadows: signedAdjustment,
	whites: signedAdjustment,
	blacks: signedAdjustment,
	temperature: signedAdjustment,
	tint: signedAdjustment,
	vibrance: signedAdjustment,
	saturation: signedAdjustment,
	clarity: signedAdjustment,
	sharpness: signedAdjustment,
	vignette: signedAdjustment,
	dehaze: signedAdjustment,
	bloom: positiveAdjustment,
	grain: positiveAdjustment
});

export type PhotoAdjustments = z.infer<typeof photoAdjustmentsSchema>;
export type PhotoAdjustmentKey = keyof PhotoAdjustments;

export function defaultPhotoAdjustments(): PhotoAdjustments {
	return {
		exposure: 0,
		contrast: 0,
		highlights: 0,
		shadows: 0,
		whites: 0,
		blacks: 0,
		temperature: 0,
		tint: 0,
		vibrance: 0,
		saturation: 0,
		clarity: 0,
		sharpness: 0,
		vignette: 0,
		dehaze: 0,
		bloom: 0,
		grain: 0
	};
}

export const PHOTO_ADJUSTMENT_GROUPS = [
	{ id: 'light', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
	{ id: 'color', keys: ['temperature', 'tint', 'vibrance', 'saturation'] },
	{ id: 'effects', keys: ['clarity', 'sharpness', 'vignette', 'dehaze', 'bloom', 'grain'] }
] as const satisfies readonly { id: string; keys: readonly PhotoAdjustmentKey[] }[];

export const PHOTO_PRESETS = [
	{ id: 'original', adjustments: defaultPhotoAdjustments() },
	{
		id: 'clean',
		adjustments: {
			...defaultPhotoAdjustments(),
			exposure: 8,
			contrast: 8,
			shadows: 12,
			saturation: -5,
			sharpness: 12
		}
	},
	{
		id: 'crispDay',
		adjustments: {
			...defaultPhotoAdjustments(),
			exposure: 10,
			highlights: -16,
			temperature: -8,
			clarity: 18,
			vibrance: 12
		}
	},
	{
		id: 'warmDusk',
		adjustments: {
			...defaultPhotoAdjustments(),
			exposure: -5,
			temperature: 28,
			tint: 5,
			highlights: -15,
			shadows: 8
		}
	},
	{
		id: 'brightRoom',
		adjustments: {
			...defaultPhotoAdjustments(),
			exposure: 22,
			shadows: 24,
			highlights: -20,
			whites: 8
		}
	},
	{
		id: 'tealOrange',
		adjustments: {
			...defaultPhotoAdjustments(),
			contrast: 18,
			temperature: 18,
			tint: -12,
			vibrance: 24,
			shadows: -10
		}
	},
	{
		id: 'vintage',
		adjustments: {
			...defaultPhotoAdjustments(),
			contrast: -15,
			temperature: 20,
			saturation: -24,
			blacks: 20,
			grain: 12,
			vignette: 18
		}
	},
	{
		id: 'dreamy',
		adjustments: {
			...defaultPhotoAdjustments(),
			exposure: 8,
			contrast: -12,
			temperature: -14,
			saturation: -12,
			clarity: -18,
			bloom: 22
		}
	}
] as const;

export const MAX_PROCESSED_PHOTO_SIZE = 32 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 20_000_000;

export function hasPhotoAdjustments(adjustments: PhotoAdjustments): boolean {
	return Object.values(adjustments).some((value) => value !== 0);
}
