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

import {
	MAX_PHOTO_PIXELS,
	photoAdjustmentsSchema,
	type PhotoAdjustments
} from '$lib/photo-adjustments';
import { adjustPhotoPixels } from '$lib/photo-processing';
import type { OutputFormat } from '$lib/api/contract';

export interface PhotoWorkerRequest {
	image?: Blob;
	settings: PhotoAdjustments;
	maxEdge?: number;
	format?: OutputFormat;
}

export type PhotoWorkerResponse = { blob: Blob } | { error: 'too_large' | 'processing_failed' };

let sourcePixels: ImageData | undefined;

self.onmessage = async (event: MessageEvent<PhotoWorkerRequest>): Promise<void> => {
	let bitmap: ImageBitmap | undefined;
	try {
		const { image, settings, maxEdge, format = 'webp' } = event.data;
		if (image) {
			bitmap = await createImageBitmap(image);
			if (bitmap.width * bitmap.height > MAX_PHOTO_PIXELS && maxEdge === undefined) {
				self.postMessage({ error: 'too_large' } satisfies PhotoWorkerResponse);
				return;
			}
			const scale = maxEdge ? Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height)) : 1;
			const width = Math.max(1, Math.round(bitmap.width * scale));
			const height = Math.max(1, Math.round(bitmap.height * scale));
			const sourceCanvas = new OffscreenCanvas(width, height);
			const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
			if (!sourceContext) throw new Error('Photo canvas unavailable');
			sourceContext.drawImage(bitmap, 0, 0, width, height);
			sourcePixels = sourceContext.getImageData(0, 0, width, height);
		}
		if (!sourcePixels) throw new Error('Photo source unavailable');
		const { width, height } = sourcePixels;
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Photo canvas unavailable');
		const pixels = new ImageData(width, height);
		pixels.data.set(
			adjustPhotoPixels(sourcePixels.data, width, height, photoAdjustmentsSchema.parse(settings))
		);
		context.putImageData(pixels, 0, 0);
		const blob = await canvas.convertToBlob({
			type: format === 'jpg' ? 'image/jpeg' : `image/${format}`,
			quality: 0.98
		});
		self.postMessage({ blob } satisfies PhotoWorkerResponse);
	} catch {
		self.postMessage({ error: 'processing_failed' } satisfies PhotoWorkerResponse);
	} finally {
		bitmap?.close();
	}
};
