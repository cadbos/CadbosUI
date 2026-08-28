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

const REFERENCE_SCALE_BACKGROUND = '#ffffff';
const DEFAULT_SCALE_MIME = 'image/png';

export interface ScaleDrawRect {
	dx: number;
	dy: number;
	dw: number;
	dh: number;
}

// Where to draw the source image onto a same-size destination canvas so the
// subject appears `scale`x its original size: scale > 1 zooms in (the canvas
// clips the overflow), scale < 1 leaves a padded margin around it.
export function objectScaleDrawRect(width: number, height: number, scale: number): ScaleDrawRect {
	const dw = width * scale;
	const dh = height * scale;
	return {
		dx: (width - dw) / 2,
		dy: (height - dh) / 2,
		dw,
		dh
	};
}

// Re-frames a reference-object photo so the subject reads as larger/smaller
// within the frame — the only lever available to influence the object-replace
// model's apparent sense of scale without a mask/bbox control in its workflow.
export async function scaleReferenceImageBlob(
	blob: Blob,
	scale: number,
	mime?: string
): Promise<Blob> {
	const bitmap = await createImageBitmap(blob);
	try {
		const { width, height } = bitmap;
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('2d canvas context unavailable');
		context.fillStyle = REFERENCE_SCALE_BACKGROUND;
		context.fillRect(0, 0, width, height);
		const { dx, dy, dw, dh } = objectScaleDrawRect(width, height, scale);
		context.drawImage(bitmap, dx, dy, dw, dh);
		return await canvas.convertToBlob({ type: mime ?? DEFAULT_SCALE_MIME });
	} finally {
		bitmap.close();
	}
}
