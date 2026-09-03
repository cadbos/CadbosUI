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

import { PhotonImage, SamplingFilter, resize, watermark } from '@cf-wasm/photon';
import type { ObjectAdderRect } from '$lib/api/contract';

// Composited server-side (not in the browser) because the scene image is
// usually already hosted on the uploads CDN by this point (a prior render/
// edit result, or a photo uploaded earlier in the session) — reading pixels
// back out of a <canvas> after drawing a cross-origin image throws unless
// that origin sends permissive CORS headers, which the uploads bucket isn't
// guaranteed to do. Doing the flattening here, on already-downloaded bytes
// (see submitObjectAdder's downloadRemoteImage calls), sidesteps that
// entirely.
export class ObjectAdderCompositeError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ObjectAdderCompositeError';
	}
}

export interface ComposedImage {
	bytes: ArrayBuffer;
	mime: string;
}

const JPEG_QUALITY = 92;

// photon's own Uint8Array output is parameterized over ArrayBufferLike (which
// also covers SharedArrayBuffer), which Blob's BlobPart type rejects — slicing
// copies it into a plain, exactly-sized ArrayBuffer, matching the ArrayBuffer
// shape downloadRemoteImage's bytes already use elsewhere in this codebase.
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
	return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

export function composeObjectAdderImage(
	sceneBytes: ArrayBuffer,
	objectBytes: ArrayBuffer,
	rect: ObjectAdderRect
): ComposedImage {
	let scene: PhotonImage | undefined;
	let object: PhotonImage | undefined;
	let resizedObject: PhotonImage | undefined;
	try {
		try {
			scene = PhotonImage.new_from_byteslice(new Uint8Array(sceneBytes));
			object = PhotonImage.new_from_byteslice(new Uint8Array(objectBytes));
		} catch (error) {
			throw new ObjectAdderCompositeError('Unsupported image format', { cause: error });
		}
		const sceneWidth = scene.get_width();
		const sceneHeight = scene.get_height();
		if (sceneWidth === 0 || sceneHeight === 0) {
			throw new ObjectAdderCompositeError('Empty scene image');
		}
		const width = Math.min(sceneWidth, Math.max(1, Math.round(rect.width * sceneWidth)));
		const height = Math.min(sceneHeight, Math.max(1, Math.round(rect.height * sceneHeight)));
		const x = Math.min(Math.max(0, Math.round(rect.x * sceneWidth)), sceneWidth - width);
		const y = Math.min(Math.max(0, Math.round(rect.y * sceneHeight)), sceneHeight - height);
		resizedObject = resize(object, width, height, SamplingFilter.Lanczos3);
		watermark(scene, resizedObject, BigInt(x), BigInt(y));
		return { bytes: toArrayBuffer(scene.get_bytes_jpeg(JPEG_QUALITY)), mime: 'image/jpeg' };
	} finally {
		scene?.free();
		object?.free();
		resizedObject?.free();
	}
}
