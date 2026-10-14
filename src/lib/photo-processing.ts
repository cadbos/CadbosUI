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

import type { PhotoAdjustments } from '$lib/photo-adjustments';

function clamp(value: number): number {
	return Math.max(0, Math.min(255, value));
}

function blurLuminance(
	input: Float32Array,
	width: number,
	height: number,
	radius: number
): Float32Array {
	const horizontal = new Float32Array(input.length);
	const output = new Float32Array(input.length);
	const diameter = 2 * radius + 1;
	for (let y = 0; y < height; y++) {
		const row = y * width;
		let sum = 0;
		for (let x = -radius; x <= radius; x++) sum += input[row + Math.max(0, Math.min(width - 1, x))];
		for (let x = 0; x < width; x++) {
			horizontal[row + x] = sum / diameter;
			sum +=
				input[row + Math.min(width - 1, x + radius + 1)] - input[row + Math.max(0, x - radius)];
		}
	}
	for (let x = 0; x < width; x++) {
		let sum = 0;
		for (let y = -radius; y <= radius; y++)
			sum += horizontal[Math.max(0, Math.min(height - 1, y)) * width + x];
		for (let y = 0; y < height; y++) {
			output[y * width + x] = sum / diameter;
			sum +=
				horizontal[Math.min(height - 1, y + radius + 1) * width + x] -
				horizontal[Math.max(0, y - radius) * width + x];
		}
	}
	return output;
}

export function adjustPhotoPixels(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	settings: PhotoAdjustments
): Uint8ClampedArray {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		pixels.length !== width * height * 4
	)
		throw new Error('Invalid photo dimensions');
	const result = new Uint8ClampedArray(pixels.length);
	const exposure = 2 ** (settings.exposure / 50);
	const contrast = 2 ** (settings.contrast / 65);
	for (let i = 0; i < pixels.length; i += 4) {
		let red = pixels[i] * exposure;
		let green = pixels[i + 1] * exposure;
		let blue = pixels[i + 2] * exposure;
		const light = Math.min(1, (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255);
		const tones =
			(settings.shadows * (1 - light) ** 2 +
				settings.highlights * light ** 2 +
				settings.whites * light ** 4 +
				settings.blacks * (1 - light) ** 4) *
			0.65;
		red =
			(red + tones - 127.5) * contrast + 127.5 + settings.temperature * 0.22 + settings.tint * 0.08;
		green = (green + tones - 127.5) * contrast + 127.5 - settings.tint * 0.18;
		blue =
			(blue + tones - 127.5) * contrast +
			127.5 -
			settings.temperature * 0.22 +
			settings.tint * 0.08;
		const haze = settings.dehaze / 100;
		const dark = Math.min(red, green, blue);
		red = (red - dark * haze * 0.35) * (1 + haze * 0.35);
		green = (green - dark * haze * 0.35) * (1 + haze * 0.35);
		blue = (blue - dark * haze * 0.35) * (1 + haze * 0.35);
		const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
		const chroma = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
		const saturation = Math.max(
			0,
			(1 + settings.saturation / 100) * (1 + (settings.vibrance / 100) * (1 - Math.min(1, chroma)))
		);
		result[i] = clamp(luminance + (red - luminance) * saturation);
		result[i + 1] = clamp(luminance + (green - luminance) * saturation);
		result[i + 2] = clamp(luminance + (blue - luminance) * saturation);
		result[i + 3] = pixels[i + 3];
	}
	let detail: Float32Array | undefined;
	let clarity: Float32Array | undefined;
	let sharpness: Float32Array | undefined;
	let bloom: Float32Array | undefined;
	if (settings.clarity !== 0 || settings.sharpness !== 0 || settings.bloom !== 0) {
		detail = new Float32Array(width * height);
		for (let i = 0; i < detail.length; i++)
			detail[i] = result[i * 4] * 0.2126 + result[i * 4 + 1] * 0.7152 + result[i * 4 + 2] * 0.0722;
		const edge = Math.min(width, height);
		if (settings.clarity !== 0)
			clarity = blurLuminance(detail, width, height, Math.max(1, Math.round(edge * 0.015)));
		if (settings.sharpness !== 0)
			sharpness = blurLuminance(detail, width, height, Math.max(1, Math.round(edge * 0.0015)));
		if (settings.bloom !== 0) {
			const highlights = detail.map((value) => Math.max(0, value - 160));
			bloom = blurLuminance(highlights, width, height, Math.max(1, Math.round(edge * 0.012)));
		}
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			const i = index * 4;
			const localDetail =
				(clarity && detail ? ((detail[index] - clarity[index]) * settings.clarity) / 100 : 0) +
				(sharpness && detail ? ((detail[index] - sharpness[index]) * settings.sharpness) / 70 : 0);
			const glow = bloom ? (bloom[index] * settings.bloom) / 100 : 0;
			const distance = (((x + 0.5) / width) * 2 - 1) ** 2 + (((y + 0.5) / height) * 2 - 1) ** 2;
			const vignette = 1 - (settings.vignette / 100) * Math.min(1, distance / 1.5) ** 2 * 0.7;
			let seed = Math.imul(index + 1, 374761393);
			seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
			const noise = ((seed >>> 0) / 4294967295 - 0.5) * settings.grain * 0.7;
			for (let channel = 0; channel < 3; channel++)
				result[i + channel] = clamp((result[i + channel] + localDetail + glow) * vignette + noise);
		}
	}
	return result;
}
