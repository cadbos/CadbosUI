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

const CHECKSUM = /^(?:|[0-9a-f]{64})$/;

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

export async function getBucketByName(db: D1Database, name: string): Promise<Bucket> {
	const bucket = await db
		.prepare('SELECT id, name, url, region FROM buckets WHERE name = ?')
		.bind(name)
		.first<Bucket>();
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
	db: D1Database,
	bucket: Bucket,
	filename: string,
	checksum: string
): Promise<Media> {
	if (!filename) throw new Error('media key is empty');
	const normalizedChecksum = normalizeChecksum(checksum);
	const existing = await db
		.prepare('SELECT id, filename, bucket, checksum FROM media WHERE bucket = ? AND filename = ?')
		.bind(bucket.id, filename)
		.first<MediaRow>();
	if (existing) {
		if (existing.checksum && normalizedChecksum && existing.checksum !== normalizedChecksum) {
			await db.prepare("UPDATE media SET checksum = '' WHERE id = ?").bind(existing.id).run();
			return { ...existing, bucket, checksum: '' };
		}
		if (!existing.checksum && normalizedChecksum) {
			await db
				.prepare('UPDATE media SET checksum = ? WHERE id = ?')
				.bind(normalizedChecksum, existing.id)
				.run();
		}
		return { ...existing, bucket, checksum: existing.checksum || normalizedChecksum };
	}

	const row = await db
		.prepare(
			'INSERT INTO media (filename, bucket, checksum) VALUES (?, ?, ?) ' +
				'ON CONFLICT (bucket, filename) DO NOTHING RETURNING id, filename, bucket, checksum'
		)
		.bind(filename, bucket.id, normalizedChecksum)
		.first<MediaRow>();
	if (row) return { ...row, bucket };
	return getOrCreateMediaInBucket(db, bucket, filename, normalizedChecksum);
}

export async function getOrCreateMediaByKey(
	db: D1Database,
	bucket: Bucket,
	key: string,
	checksum: string
): Promise<Media> {
	return getOrCreateMediaInBucket(db, bucket, key, checksum);
}

export async function getMedia(db: D1Database, mediaId: number): Promise<Media | null> {
	const row = await db
		.prepare(
			'SELECT media.id, media.filename, media.bucket, media.checksum, ' +
				'buckets.name AS bucket_name, buckets.url AS bucket_url, ' +
				'buckets.region AS bucket_region FROM media ' +
				'JOIN buckets ON buckets.id = media.bucket ' +
				'WHERE media.id = ?'
		)
		.bind(mediaId)
		.first<JoinedMediaRow>();
	return row ? toMedia(row) : null;
}

export async function getMediaBatch(db: D1Database, mediaIds: number[]): Promise<Media[]> {
	const ids = [...new Set(mediaIds)];
	if (ids.length === 0) return [];
	const rows: JoinedMediaRow[] = [];
	for (let offset = 0; offset < ids.length; offset += 100) {
		const chunk = ids.slice(offset, offset + 100);
		const placeholders = chunk.map(() => '?').join(', ');
		const { results } = await db
			.prepare(
				'SELECT media.id, media.filename, media.bucket, media.checksum, ' +
					'buckets.name AS bucket_name, buckets.url AS bucket_url, ' +
					'buckets.region AS bucket_region FROM media ' +
					'JOIN buckets ON buckets.id = media.bucket ' +
					`WHERE media.id IN (${placeholders})`
			)
			.bind(...chunk)
			.all<JoinedMediaRow>();
		rows.push(...(results ?? []));
	}
	return rows.sort((left, right) => left.id - right.id).map(toMedia);
}

export async function getMediaByBucketKey(
	db: D1Database,
	bucketName: string,
	filename: string
): Promise<Media | null> {
	const row = await db
		.prepare(
			'SELECT media.id, media.filename, media.bucket, media.checksum, ' +
				'buckets.name AS bucket_name, buckets.url AS bucket_url, ' +
				'buckets.region AS bucket_region FROM media ' +
				'JOIN buckets ON buckets.id = media.bucket ' +
				'WHERE buckets.name = ? AND media.filename = ?'
		)
		.bind(bucketName, filename)
		.first<JoinedMediaRow>();
	return row ? toMedia(row) : null;
}
