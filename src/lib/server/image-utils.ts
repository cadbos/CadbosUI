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

const IMAGE_MIME_BY_EXTENSION = {
	avif: 'image/avif',
	gif: 'image/gif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
} as const;

type ImageExtension = keyof typeof IMAGE_MIME_BY_EXTENSION;
type ImageMime = (typeof IMAGE_MIME_BY_EXTENSION)[ImageExtension];

const IMAGE_EXTENSIONS = new Set<string>(Object.keys(IMAGE_MIME_BY_EXTENSION));

const FILE_KEY_PATTERN = /^[A-Za-z0-9_.~-]+$/;

export function imageCacheControl(): string {
	return 'public, max-age=31536000, immutable';
}

export function imageExtensionFromMime(mime: string): ImageExtension | null {
	const normalized = normalizeImageContentType(mime);
	if (normalized === null) return null;
	if (normalized === 'image/jpeg') return 'jpg';

	for (const [extension, candidateMime] of Object.entries(IMAGE_MIME_BY_EXTENSION)) {
		if (candidateMime === normalized) return extension as ImageExtension;
	}

	return null;
}

export function imageMimeMatchesExtension(mime: string, extension: string): boolean {
	const normalized = normalizeImageContentType(mime);
	if (normalized === null) return false;

	const expectedMime = IMAGE_MIME_BY_EXTENSION[extension.toLowerCase() as ImageExtension];
	return expectedMime === normalized;
}

export function normalizeImageContentType(contentType: string | null): ImageMime | null {
	const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase();
	if (normalized === undefined) return null;

	return Object.values(IMAGE_MIME_BY_EXTENSION).includes(normalized as ImageMime)
		? (normalized as ImageMime)
		: null;
}

export function parseProxyImageName(
	imageName: string
): { fileKey: string; extension: ImageExtension } | null {
	const dotIndex = imageName.lastIndexOf('.');
	if (dotIndex <= 0 || dotIndex === imageName.length - 1) return null;

	const fileKey = imageName.slice(0, dotIndex);
	const extension = imageName.slice(dotIndex + 1).toLowerCase();
	if (!FILE_KEY_PATTERN.test(fileKey) || !IMAGE_EXTENSIONS.has(extension)) return null;

	return { fileKey, extension: extension as ImageExtension };
}
