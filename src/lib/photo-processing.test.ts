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
	defaultPhotoAdjustments,
	photoAdjustmentsSchema,
	type PhotoAdjustmentKey
} from '$lib/photo-adjustments';
import { adjustPhotoPixels } from '$lib/photo-processing';

const WIDTH = 16;
const HEIGHT = 12;

function samplePixels(): Uint8ClampedArray {
	const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const index = (y * WIDTH + x) * 4;
			pixels[index] = (x * 13 + y * 11 + 30) % 256;
			pixels[index + 1] = (x * 7 + y * 19 + 40) % 256;
			pixels[index + 2] = x < WIDTH / 2 ? 60 + y * 12 : 220 - y * 9;
			pixels[index + 3] = (x * 19 + y * 17) % 256;
		}
	}
	return pixels;
}

function alphaValues(pixels: Uint8ClampedArray): number[] {
	return Array.from(pixels).filter((_, index) => index % 4 === 3);
}

describe('photo pixel adjustments', () => {
	it('preserves neutral pixels byte for byte, including transparent pixels, without mutating input', () => {
		const source = samplePixels();
		const original = source.slice();
		const result = adjustPhotoPixels(source, WIDTH, HEIGHT, defaultPhotoAdjustments());

		expect(result).toEqual(original);
		expect(source).toEqual(original);
		expect(result).not.toBe(source);
	});

	it('brightens and darkens midtones with positive and negative exposure', () => {
		const source = new Uint8ClampedArray([64, 80, 96, 127]);
		const brighter = adjustPhotoPixels(source, 1, 1, {
			...defaultPhotoAdjustments(),
			exposure: 50
		});
		const darker = adjustPhotoPixels(source, 1, 1, {
			...defaultPhotoAdjustments(),
			exposure: -50
		});

		expect(brighter).toEqual(new Uint8ClampedArray([128, 160, 192, 127]));
		expect(darker).toEqual(new Uint8ClampedArray([32, 40, 48, 127]));
	});

	it('makes full desaturation grayscale while retaining alpha', () => {
		const source = samplePixels();
		const result = adjustPhotoPixels(source, WIDTH, HEIGHT, {
			...defaultPhotoAdjustments(),
			saturation: -100
		});

		for (let i = 0; i < result.length; i += 4) {
			expect(result[i]).toBe(result[i + 1]);
			expect(result[i]).toBe(result[i + 2]);
		}
		expect(alphaValues(result)).toEqual(alphaValues(source));
	});

	it.each(Object.keys(defaultPhotoAdjustments()) as PhotoAdjustmentKey[])(
		'%s changes varied tones and edges while preserving alpha and the source',
		(key) => {
			const source = samplePixels();
			const original = source.slice();
			const result = adjustPhotoPixels(source, WIDTH, HEIGHT, {
				...defaultPhotoAdjustments(),
				[key]: 65
			});

			expect(result).not.toEqual(original);
			expect(alphaValues(result)).toEqual(alphaValues(original));
			expect(source).toEqual(original);
		}
	);

	it('adds repeatable grain rather than changing noise with each preview', () => {
		const source = samplePixels();
		const settings = { ...defaultPhotoAdjustments(), grain: 40 };
		const first = adjustPhotoPixels(source, WIDTH, HEIGHT, settings);
		const second = adjustPhotoPixels(source, WIDTH, HEIGHT, settings);

		expect(first).toEqual(second);
		expect(first).not.toEqual(source);
		expect(adjustPhotoPixels(source, WIDTH, HEIGHT, { ...settings, grain: 0 })).toEqual(source);
	});

	it('darkens corners more than the center with positive vignette', () => {
		const source = new Uint8ClampedArray(5 * 5 * 4).fill(180);
		const result = adjustPhotoPixels(source, 5, 5, {
			...defaultPhotoAdjustments(),
			vignette: 100
		});

		expect(result[0]).toBeLessThan(result[(2 * 5 + 2) * 4]);
		expect(result[(2 * 5 + 2) * 4]).toBe(180);
	});

	it.each([
		{ width: 0, height: 1, length: 0 },
		{ width: 1, height: -1, length: 0 },
		{ width: 2, height: 2, length: 4 },
		{ width: 1.5, height: 2, length: 12 },
		{ width: Number.NaN, height: 1, length: 0 },
		{ width: Number.POSITIVE_INFINITY, height: 1, length: 0 }
	])(
		'rejects invalid dimensions $width × $height or mismatched pixels',
		({ width, height, length }) => {
			expect(() =>
				adjustPhotoPixels(new Uint8ClampedArray(length), width, height, defaultPhotoAdjustments())
			).toThrow('Invalid photo dimensions');
		}
	);
});

describe('photo adjustment validation', () => {
	it('accepts neutral settings and rejects unknown, missing, fractional and out-of-range controls', () => {
		const settings = defaultPhotoAdjustments();
		expect(photoAdjustmentsSchema.safeParse(settings).success).toBe(true);
		expect(photoAdjustmentsSchema.safeParse({ ...settings, exposure: 101 }).success).toBe(false);
		expect(photoAdjustmentsSchema.safeParse({ ...settings, temperature: -101 }).success).toBe(
			false
		);
		expect(photoAdjustmentsSchema.safeParse({ ...settings, contrast: 0.5 }).success).toBe(false);
		expect(photoAdjustmentsSchema.safeParse({ ...settings, grain: -1 }).success).toBe(false);
		expect(photoAdjustmentsSchema.safeParse({ ...settings, bloom: -1 }).success).toBe(false);
		expect(photoAdjustmentsSchema.safeParse({ ...settings, exposure: undefined }).success).toBe(
			false
		);
		expect(photoAdjustmentsSchema.safeParse({ ...settings, unknownControl: 20 }).success).toBe(
			false
		);
	});
});
