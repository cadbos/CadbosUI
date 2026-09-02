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

import type { D1Database } from '@cloudflare/workers-types';
import type { MediaAccess } from '$lib/api/contract';
import {
	getMedia,
	getMediaBatch,
	getMediaByBucketKey,
	mediaKey,
	parseMediaKey,
	type Media
} from '$lib/server/media';
import { presignS3Object, type S3PresignPurpose } from '$lib/server/s3';

export async function mediaAccess(
	platform: App.Platform | undefined,
	media: Media,
	purpose: S3PresignPurpose = 'ui'
): Promise<MediaAccess> {
	return {
		key: mediaKey(media.bucket.name, media.filename),
		url: await presignS3Object(platform, media.bucket, media.filename, purpose)
	};
}

export async function mediaAccessById(
	db: D1Database,
	platform: App.Platform | undefined,
	mediaId: number,
	purpose: S3PresignPurpose = 'ui'
): Promise<MediaAccess | null> {
	const media = await getMedia(db, mediaId);
	return media ? mediaAccess(platform, media, purpose) : null;
}

export async function mediaAccessBatch(
	db: D1Database,
	platform: App.Platform | undefined,
	mediaIds: number[]
): Promise<Map<number, MediaAccess> | null> {
	const uniqueIds = [...new Set(mediaIds)];
	const media = await getMediaBatch(db, uniqueIds);
	if (media.length !== uniqueIds.length) return null;
	const access = await Promise.all(media.map((item) => mediaAccess(platform, item)));
	return new Map(media.map((item, index) => [item.id, access[index]]));
}

export async function providerMediaBatch(
	db: D1Database,
	platform: App.Platform | undefined,
	keys: string[]
): Promise<Map<string, { media: Media; url: string }> | null> {
	const uniqueKeys = [...new Set(keys)];
	const result = new Map<string, { media: Media; url: string }>();
	for (const key of uniqueKeys) {
		const parsed = parseMediaKey(key);
		if (!parsed) return null;
		const media = await getMediaByBucketKey(db, parsed.bucketName, parsed.filename);
		if (!media) return null;
		result.set(key, { media, url: (await mediaAccess(platform, media, 'provider')).url });
	}
	return result;
}
