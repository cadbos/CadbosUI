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

interface BucketRow {
	id: number;
	name: string;
	url: string;
}

export async function setBucketUrl(db: Database, name: string, url: string): Promise<void> {
	await db.run(sql`UPDATE buckets SET url = ${url.replace(/\/+$/, '')} WHERE name = ${name}`);
}

export async function seedMedia(db: Database, url: string, checksum = ''): Promise<number> {
	const buckets = await db.all<BucketRow>(sql`SELECT id, name, url FROM buckets`);
	let bucket: BucketRow | null =
		buckets
			.filter((candidate) => url === candidate.url || url.startsWith(`${candidate.url}/`))
			.sort((left, right) => right.url.length - left.url.length)[0] ?? null;
	if (!bucket) {
		const origin = new URL(url).origin;
		await db.run(
			sql`INSERT OR IGNORE INTO buckets (name, url) VALUES (${`external:${origin}`}, ${origin})`
		);
		bucket =
			(await db.get<BucketRow>(sql`SELECT id, name, url FROM buckets WHERE url = ${origin}`)) ??
			null;
	}
	if (!bucket) throw new Error('media bucket seed failed');
	const filename = url.slice(bucket.url.length).replace(/^\//, '');
	await db.run(
		sql`INSERT OR IGNORE INTO media (filename, bucket, checksum) VALUES (${filename}, ${bucket.id}, ${checksum})`
	);
	const media = await db.get<{ id: number }>(
		sql`SELECT id FROM media WHERE bucket = ${bucket.id} AND filename = ${filename}`
	);
	if (!media) throw new Error('media seed failed');
	return media.id;
}

export async function seedGeneration(
	db: Database,
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
): Promise<void> {
	const resultMediaId = await seedMedia(db, input.url, input.resultChecksum);
	const sourceMediaId = await seedMedia(db, input.sourceUrl, input.sourceChecksum);
	await db.run(
		sql`INSERT INTO generations
			(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, session_id)
			VALUES (${input.id}, ${input.userId}, ${resultMediaId}, ${sourceMediaId}, ${input.prompt ?? 'cozy'}, ${input.kind ?? 'render'}, ${input.amount ?? 1}, ${input.balanceAfter ?? 10}, ${input.createdAt}, ${input.sessionId ?? null})`
	);
}
