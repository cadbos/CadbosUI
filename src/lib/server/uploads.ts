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

import { dev } from '$app/environment';
import { imageExtensionFromMime, normalizeImageContentType, type ImageMime } from '$lib/image-mime';
import type { Bucket } from '$lib/server/media';
import { mockUpload } from '$lib/server/mocks/fixtures';
import { putS3Object } from '$lib/server/s3';

export type StoredImage = {
	key: string;
	mime: ImageMime;
	size: number;
	hash: string;
	dimensions?: [number, number];
};

const STORAGE_RETRY_DELAYS_MS = [0, 250, 1_000] as const;

// Content hash used to dedup repeat uploads of the same photo against
// media.checksum (see findGenerationSourceByHash). Not a security
// boundary — just a lookup key — so a fast, non-cryptographic-strength
// concern doesn't apply; SHA-256 is used because it's already available via
// Web Crypto in the Workers runtime.
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

async function storeImage(
	platform: App.Platform | undefined,
	bucket: Bucket,
	bytes: ArrayBuffer,
	mime: string,
	storageKey?: string,
	precomputedHash?: string
): Promise<StoredImage> {
	if (dev && (!platform?.env?.S3_ACCESS_KEY_ID || !platform.env.S3_SECRET_ACCESS_KEY)) {
		const upload = mockUpload();
		const normalizedMime = normalizeImageContentType(upload.mime);
		if (normalizedMime === null) throw new Error(`Unsupported image type: ${upload.mime}`);

		return {
			key: new URL(upload.image.url).pathname.replace(/^\//, ''),
			mime: normalizedMime,
			size: upload.size,
			hash: precomputedHash ?? (await hashBytes(bytes)),
			dimensions: upload.dimensions
		};
	}

	const normalizedMime = normalizeImageContentType(mime);
	if (normalizedMime === null) throw new Error(`Unsupported image type: ${mime}`);

	const extension = imageExtensionFromMime(normalizedMime);
	const key = storageKey ?? `${crypto.randomUUID()}.${extension}`;
	await putS3Object(platform, bucket, key, bytes, normalizedMime);

	return {
		key,
		mime: normalizedMime,
		size: bytes.byteLength,
		hash: precomputedHash ?? (await hashBytes(bytes))
	};
}

export async function uploadImage(
	platform: App.Platform | undefined,
	bucket: Bucket,
	file: File,
	precomputedHash?: string
): Promise<StoredImage> {
	return storeImage(
		platform,
		bucket,
		await file.arrayBuffer(),
		file.type,
		undefined,
		precomputedHash
	);
}

export async function uploadImageBytes(
	platform: App.Platform | undefined,
	bucket: Bucket,
	bytes: ArrayBuffer,
	mime: string,
	storageKey?: string,
	precomputedHash?: string
): Promise<StoredImage> {
	return storeImage(platform, bucket, bytes, mime, storageKey, precomputedHash);
}

export async function uploadGeneratedImageBytes(
	platform: App.Platform | undefined,
	bucket: Bucket,
	bytes: ArrayBuffer,
	mime: string,
	storageKey: string
): Promise<StoredImage> {
	let lastError: unknown;
	for (const delay of STORAGE_RETRY_DELAYS_MS) {
		if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
		try {
			return await uploadImageBytes(platform, bucket, bytes, mime, storageKey);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}
