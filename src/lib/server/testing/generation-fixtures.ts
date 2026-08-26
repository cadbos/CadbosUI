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

import type { D1Database, D1Result } from '@cloudflare/workers-types';

interface BucketRow {
	id: number;
	name: string;
	url: string;
}

function syncFirst<T>(value: Promise<T | null>): T | null {
	return value as unknown as T | null;
}

function syncResults<T>(value: Promise<D1Result<T>>): T[] {
	return (value as unknown as D1Result<T>).results;
}

export function setBucketUrl(db: D1Database, name: string, url: string): void {
	db.prepare('UPDATE buckets SET url = ? WHERE name = ?').bind(url.replace(/\/+$/, ''), name).run();
}

export function seedMedia(db: D1Database, url: string, checksum = ''): number {
	const buckets = syncResults(db.prepare('SELECT id, name, url FROM buckets').all<BucketRow>());
	let bucket: BucketRow | null =
		buckets
			.filter((candidate) => url === candidate.url || url.startsWith(`${candidate.url}/`))
			.sort((left, right) => right.url.length - left.url.length)[0] ?? null;
	if (!bucket) {
		const origin = new URL(url).origin;
		db.prepare('INSERT OR IGNORE INTO buckets (name, url) VALUES (?, ?)')
			.bind(`external:${origin}`, origin)
			.run();
		bucket = syncFirst(
			db.prepare('SELECT id, name, url FROM buckets WHERE url = ?').bind(origin).first<BucketRow>()
		);
	}
	if (!bucket) throw new Error('media bucket seed failed');
	const filename = url.slice(bucket.url.length).replace(/^\//, '');
	db.prepare('INSERT OR IGNORE INTO media (filename, bucket, checksum) VALUES (?, ?, ?)')
		.bind(filename, bucket.id, checksum)
		.run();
	const media = syncFirst(
		db
			.prepare('SELECT id FROM media WHERE bucket = ? AND filename = ?')
			.bind(bucket.id, filename)
			.first<{ id: number }>()
	);
	if (!media) throw new Error('media seed failed');
	return media.id;
}

export function seedGeneration(
	db: D1Database,
	input: {
		id: string;
		userId: string;
		url: string;
		sourceUrl: string;
		createdAt: number;
		sessionId?: string | null;
		resultChecksum?: string;
		sourceChecksum?: string;
		prompt?: string;
		kind?: string;
		amount?: number;
		balanceAfter?: number;
	}
): void {
	const resultMediaId = seedMedia(db, input.url, input.resultChecksum);
	const sourceMediaId = seedMedia(db, input.sourceUrl, input.sourceChecksum);
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, session_id) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	)
		.bind(
			input.id,
			input.userId,
			resultMediaId,
			sourceMediaId,
			input.prompt ?? 'cozy',
			input.kind ?? 'render',
			input.amount ?? 1,
			input.balanceAfter ?? 10,
			input.createdAt,
			input.sessionId ?? null
		)
		.run();
}
