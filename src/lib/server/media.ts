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

import { sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { DEFAULT_UPLOADS_BUCKET_NAME } from '$lib/api/contract';

export { DEFAULT_UPLOADS_BUCKET_NAME } from '$lib/api/contract';

const CHECKSUM = /^(?:|[0-9a-f]{64})$/;

export function uploadsBucketName(platform: App.Platform | undefined): string {
	return platform?.env?.S3_UPLOADS_BUCKET_NAME || DEFAULT_UPLOADS_BUCKET_NAME;
}

export interface Bucket {
	id: number;
	name: string;
	url: string;
	region: string;
}

export interface Media {
	id: number;
	filename: string;
	bucket: Bucket;
	checksum: string;
}

interface MediaRow {
	id: number;
	filename: string;
	bucket: number;
	checksum: string;
}

interface JoinedMediaRow extends MediaRow {
	bucket_name: string;
	bucket_url: string;
	bucket_region: string;
}

function normalizeChecksum(checksum: string | undefined): string {
	const normalized = checksum?.toLowerCase() ?? '';
	return CHECKSUM.test(normalized) ? normalized : '';
}

export function mediaKey(bucketName: string, filename: string): string {
	if (!bucketName) throw new Error('media bucket name is empty');
	if (!filename) throw new Error('media object key is empty');
	return `${encodeURIComponent(bucketName)}/${filename}`;
}

export function parseMediaKey(key: string): { bucketName: string; filename: string } | null {
	const delimiter = key.indexOf('/');
	if (delimiter <= 0 || delimiter === key.length - 1) return null;
	const encodedBucketName = key.slice(0, delimiter);
	let bucketName: string;
	try {
		bucketName = decodeURIComponent(encodedBucketName);
	} catch {
		return null;
	}
	if (!bucketName || encodeURIComponent(bucketName) !== encodedBucketName) return null;
	return { bucketName, filename: key.slice(delimiter + 1) };
}

export async function getBucketByName(db: Database, name: string): Promise<Bucket> {
	const bucket = await db.get<Bucket>(
		sql`SELECT id, name, url, region FROM buckets WHERE name = ${name}`
	);
	if (!bucket) throw new Error(`bucket ${name} not found`);
	return bucket;
}

function toMedia(row: JoinedMediaRow): Media {
	return {
		id: row.id,
		filename: row.filename,
		bucket: {
			id: row.bucket,
			name: row.bucket_name,
			url: row.bucket_url,
			region: row.bucket_region
		},
		checksum: row.checksum
	};
}

async function getOrCreateMediaInBucket(
	db: Database,
	bucket: Bucket,
	filename: string,
	checksum: string
): Promise<Media> {
	if (!filename) throw new Error('media key is empty');
	const normalizedChecksum = normalizeChecksum(checksum);
	const existing = await db.get<MediaRow>(
		sql`SELECT id, filename, bucket, checksum FROM media WHERE bucket = ${bucket.id} AND filename = ${filename}`
	);
	if (existing) {
		if (existing.checksum && normalizedChecksum && existing.checksum !== normalizedChecksum) {
			await db.run(sql`UPDATE media SET checksum = '' WHERE id = ${existing.id}`);
			return { ...existing, bucket, checksum: '' };
		}
		if (!existing.checksum && normalizedChecksum) {
			await db.run(
				sql`UPDATE media SET checksum = ${normalizedChecksum} WHERE id = ${existing.id}`
			);
		}
		return { ...existing, bucket, checksum: existing.checksum || normalizedChecksum };
	}

	const row = await db.get<MediaRow>(
		sql`INSERT INTO media (filename, bucket, checksum) VALUES (${filename}, ${bucket.id}, ${normalizedChecksum})
			ON CONFLICT (bucket, filename) DO NOTHING RETURNING id, filename, bucket, checksum`
	);
	if (row) return { ...row, bucket };
	return getOrCreateMediaInBucket(db, bucket, filename, normalizedChecksum);
}

export async function getOrCreateMediaByKey(
	db: Database,
	bucket: Bucket,
	key: string,
	checksum: string
): Promise<Media> {
	return getOrCreateMediaInBucket(db, bucket, key, checksum);
}

export async function getMedia(db: Database, mediaId: number): Promise<Media | null> {
	const row = await db.get<JoinedMediaRow>(
		sql`SELECT media.id, media.filename, media.bucket, media.checksum,
			buckets.name AS bucket_name, buckets.url AS bucket_url,
			buckets.region AS bucket_region FROM media
			JOIN buckets ON buckets.id = media.bucket
			WHERE media.id = ${mediaId}`
	);
	return row ? toMedia(row) : null;
}

export async function getMediaBatch(db: Database, mediaIds: number[]): Promise<Media[]> {
	const ids = [...new Set(mediaIds)];
	if (ids.length === 0) return [];
	const rows: JoinedMediaRow[] = [];
	for (let offset = 0; offset < ids.length; offset += 100) {
		const chunk = ids.slice(offset, offset + 100);
		const chunkRows = await db.all<JoinedMediaRow>(
			sql`SELECT media.id, media.filename, media.bucket, media.checksum,
				buckets.name AS bucket_name, buckets.url AS bucket_url,
				buckets.region AS bucket_region FROM media
				JOIN buckets ON buckets.id = media.bucket
				WHERE media.id IN (${sql.join(
					chunk.map((id) => sql`${id}`),
					sql`, `
				)})`
		);
		rows.push(...chunkRows);
	}
	return rows.sort((left, right) => left.id - right.id).map(toMedia);
}

export async function getMediaByBucketKey(
	db: Database,
	bucketName: string,
	filename: string
): Promise<Media | null> {
	const row = await db.get<JoinedMediaRow>(
		sql`SELECT media.id, media.filename, media.bucket, media.checksum,
			buckets.name AS bucket_name, buckets.url AS bucket_url,
			buckets.region AS bucket_region FROM media
			JOIN buckets ON buckets.id = media.bucket
			WHERE buckets.name = ${bucketName} AND media.filename = ${filename}`
	);
	return row ? toMedia(row) : null;
}
