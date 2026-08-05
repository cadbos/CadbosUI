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
import {
	imageExtensionFromMime,
	normalizeImageContentType,
	type ImageMime
} from '$lib/server/image-utils';
import { mockUpload } from '$lib/server/mocks/fixtures';

type StoredImage = {
	url: string;
	mime: ImageMime;
	size: number;
	hash: string;
	dimensions?: [number, number];
};

// Content hash used to dedup repeat uploads of the same photo against
// generations.source_hash (see findGenerationSourceByHash). Not a security
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
	bytes: ArrayBuffer,
	mime: string,
	storageKey?: string,
	precomputedHash?: string
): Promise<StoredImage> {
	const bucket = platform?.env?.UPLOADS_BUCKET;
	const publicUrl = platform?.env?.UPLOADS_PUBLIC_URL;

	if (!bucket) {
		if (dev) {
			const upload = mockUpload();
			const normalizedMime = normalizeImageContentType(upload.mime);
			if (normalizedMime === null) throw new Error(`Unsupported image type: ${upload.mime}`);

			return { ...upload, mime: normalizedMime, hash: precomputedHash ?? (await hashBytes(bytes)) };
		}
		throw new Error('UPLOADS_BUCKET not configured');
	}

	if (!publicUrl) throw new Error('UPLOADS_PUBLIC_URL not configured');

	const normalizedMime = normalizeImageContentType(mime);
	if (normalizedMime === null) throw new Error(`Unsupported image type: ${mime}`);

	const extension = imageExtensionFromMime(normalizedMime);
	const key = storageKey ?? `${crypto.randomUUID()}.${extension}`;
	await bucket.put(key, bytes, {
		httpMetadata: { contentType: normalizedMime }
	});

	// A relative URL resolves against the *directory* of its base, so a base
	// without a trailing slash (e.g. https://cdn.example.com/uploads) would
	// otherwise have its last path segment replaced instead of extended.
	const base = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`;
	return {
		url: new URL(key, base).toString(),
		mime: normalizedMime,
		size: bytes.byteLength,
		hash: precomputedHash ?? (await hashBytes(bytes))
	};
}

export async function uploadImage(
	platform: App.Platform | undefined,
	file: File,
	precomputedHash?: string
): Promise<StoredImage> {
	return storeImage(platform, await file.arrayBuffer(), file.type, undefined, precomputedHash);
}

export async function uploadImageBytes(
	platform: App.Platform | undefined,
	bytes: ArrayBuffer,
	mime: string,
	storageKey?: string,
	precomputedHash?: string
): Promise<StoredImage> {
	return storeImage(platform, bytes, mime, storageKey, precomputedHash);
}
