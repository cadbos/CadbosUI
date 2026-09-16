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

import type { MediaAccess } from '$lib/api/contract';
import type { Database } from '$lib/server/db';
import {
	getMedia,
	getMediaBatch,
	getMediaByBucketKey,
	mediaKey,
	parseMediaKey,
	type Media
} from '$lib/server/media';
import { renderMediaTtl } from '$lib/server/media-ttl';
import { presignS3Object } from '$lib/server/s3';

// Not `resolve()`: on the server it returns paths relative to the current request
// (`../api/media/…`), but these links must be identical, root-absolute URLs.
export function mediaLink(bucketName: string, filename: string): MediaAccess {
	return {
		key: mediaKey(bucketName, filename),
		url: `/api/media/${encodeURIComponent(bucketName)}/${filename}`
	};
}

export function mediaAccess(media: Media): MediaAccess {
	return mediaLink(media.bucket.name, media.filename);
}

export async function mediaAccessById(db: Database, mediaId: number): Promise<MediaAccess | null> {
	const media = await getMedia(db, mediaId);
	return media ? mediaAccess(media) : null;
}

export async function mediaAccessBatch(
	db: Database,
	mediaIds: number[]
): Promise<Map<number, MediaAccess> | null> {
	const uniqueIds = [...new Set(mediaIds)];
	const media = await getMediaBatch(db, uniqueIds);
	if (media.length !== uniqueIds.length) return null;
	return new Map(media.map((item) => [item.id, mediaAccess(item)]));
}

// Resolves the media keys a restored form snapshot's reference/mask images point
// to, for the client. Keys that no longer resolve (e.g. a since-deleted reference
// image) are simply omitted rather than failing the whole batch — the caller
// degrades that one field instead of discarding every other restored setting.
export async function mediaAccessByKeyBatch(
	db: Database,
	keys: string[]
): Promise<Map<string, MediaAccess>> {
	const uniqueKeys = [...new Set(keys)];
	const result = new Map<string, MediaAccess>();
	for (const key of uniqueKeys) {
		const parsed = parseMediaKey(key);
		if (!parsed) continue;
		const media = await getMediaByBucketKey(db, parsed.bucketName, parsed.filename);
		if (!media) continue;
		result.set(key, mediaAccess(media));
	}
	return result;
}

// Render services fetch input images after the request returns, so they get
// presigned URLs instead of the app's own /api/media links.
export async function providerMediaBatch(
	db: Database,
	platform: App.Platform | undefined,
	keys: string[]
): Promise<Map<string, { media: Media; url: string }> | null> {
	const uniqueKeys = [...new Set(keys)];
	const expiresIn = renderMediaTtl(platform);
	const result = new Map<string, { media: Media; url: string }>();
	for (const key of uniqueKeys) {
		const parsed = parseMediaKey(key);
		if (!parsed) return null;
		const media = await getMediaByBucketKey(db, parsed.bucketName, parsed.filename);
		if (!media) return null;
		result.set(key, {
			media,
			url: await presignS3Object(platform, media.bucket, media.filename, expiresIn)
		});
	}
	return result;
}
