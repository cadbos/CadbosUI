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

const CHECKSUM = /^(?:|[0-9a-f]{64})$/;

export interface Bucket {
	id: number;
	name: string;
	url: string;
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

function baseUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

function normalizeChecksum(checksum: string | undefined): string {
	const normalized = checksum?.toLowerCase() ?? '';
	return CHECKSUM.test(normalized) ? normalized : '';
}

export function mediaUrl(bucketUrl: string, filename: string): string {
	const base = baseUrl(bucketUrl);
	return filename ? `${base}/${filename}` : base;
}

export async function getBucketByName(db: Database, name: string): Promise<Bucket> {
	const bucket = await db.get<Bucket>(sql`SELECT id, name, url FROM buckets WHERE name = ${name}`);
	if (!bucket) throw new Error(`bucket ${name} not found`);
	return bucket;
}

async function bucketForUrl(
	db: Database,
	value: string
): Promise<{ bucket: Bucket; filename: string }> {
	const parsed = new URL(value);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('media URL must use HTTP or HTTPS');
	}
	const normalizedUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`;

	const rows = await db.all<Bucket>(
		sql`SELECT id, name, url FROM buckets ORDER BY length(url) DESC, id`
	);
	let bucket: Bucket | null | undefined = rows.find((candidate) => {
		const base = baseUrl(candidate.url);
		return normalizedUrl === base || normalizedUrl.startsWith(`${base}/`);
	});
	if (!bucket) {
		const origin = parsed.origin;
		await db.run(
			sql`INSERT OR IGNORE INTO buckets (name, url) VALUES (${`external:${origin}`}, ${origin})`
		);
		bucket = await db.get<Bucket>(sql`SELECT id, name, url FROM buckets WHERE url = ${origin}`);
		if (!bucket) throw new Error(`bucket for ${parsed.hostname} not found`);
	}

	return {
		bucket,
		filename: normalizedUrl.slice(baseUrl(bucket.url).length).replace(/^\//, '')
	};
}

export async function getOrCreateMedia(
	db: Database,
	url: string,
	checksum: string
): Promise<Media> {
	const normalizedChecksum = normalizeChecksum(checksum);
	const { bucket, filename } = await bucketForUrl(db, url);
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
	return getOrCreateMedia(db, url, normalizedChecksum);
}
