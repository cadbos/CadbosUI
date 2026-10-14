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
import type { RequestFormSnapshot } from '$lib/api/contract';
import type { Database } from '$lib/server/db';
import { ledgerAmountSql } from '$lib/server/ledger';
import { DEFAULT_UPLOADS_BUCKET_NAME, type Bucket } from '$lib/server/media';

interface BucketRow {
	id: number;
	name: string;
	url: string;
}

export const TEST_S3_ENV = {
	S3_ACCESS_KEY_ID: 'test-access-key',
	S3_SECRET_ACCESS_KEY: 'test-secret-key'
} as const;

export const TEST_S3_BUCKET: Bucket = {
	id: 1,
	name: DEFAULT_UPLOADS_BUCKET_NAME,
	url: 'https://s3.example.test/cadbos',
	region: 'auto'
};

export const TEST_FORM_SNAPSHOT: RequestFormSnapshot = {
	promptFragments: [{ id: 'frag-1', text: 'cozy', order: 0 }],
	promptOverride: null,
	editPrompt: '',
	addObjectInstruction: '',
	removeObjectText: '',
	editOperationType: null,
	outputFormat: 'webp',
	sceneType: 'interior',
	styleTransferPrompt: '',
	styleTransferStrength: 0.7,
	styleNegativePrompt: '',
	objectReplacementObject: '',
	objectReplacementScale: 1,
	objectReplacementRegion: null,
	textureReplacementSurface: '',
	textureReplacementMasked: false,
	lightSettingsPresetIds: [],
	lightSettingsInstruction: '',
	repaintTarget: '',
	repaintColor: '#f4f1ea',
	repaintRegion: null
};

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

export async function seedManagedMedia(
	db: Database,
	filename = 'test/source.webp',
	checksum = ''
): Promise<number> {
	return seedMedia(db, `https://uploads.cadbos.example/${filename}`, checksum);
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
		formSnapshot?: RequestFormSnapshot;
	}
): Promise<void> {
	const resultMediaId = await seedMedia(db, input.url, input.resultChecksum);
	const sourceMediaId = await seedMedia(db, input.sourceUrl, input.sourceChecksum);
	await seedGenerationRecord(db, { ...input, resultMediaId, sourceMediaId });
}

export async function seedGenerationRecord(
	db: Database,
	input: {
		id: string;
		userId: string;
		resultMediaId: number;
		sourceMediaId: number;
		referenceMediaId?: number;
		createdAt: number;
		sessionId?: string | null;
		prompt?: string;
		kind?: string;
		amount?: number;
		balanceAfter?: number;
		formSnapshot?: RequestFormSnapshot;
	}
): Promise<void> {
	const amount = ledgerAmountSql(input.amount ?? 1);
	await db.batch([
		db.run(sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at)
			SELECT ${input.userId}, ABS(delta), CASE WHEN delta > 0 THEN 'credit' ELSE 'debit' END,
				'historical-reconciliation', ${input.createdAt}
			FROM (SELECT ${Math.round((input.balanceAfter ?? 10) * 100)} + ${amount} -
				COALESCE(SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END), 0) AS delta
				FROM ledger_entries WHERE user_id = ${input.userId}) WHERE delta <> 0`),
		db.run(sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at)
			VALUES (${input.userId}, ${amount}, 'debit', 'generation-charge', ${input.createdAt})`),
		db.run(sql`INSERT INTO generations
			(id, user_id, result_media_id, source_media_id, reference_media_id, prompt, kind, ledger_entry_id, created_at, session_id, form_snapshot)
			SELECT ${input.id}, ${input.userId}, ${input.resultMediaId}, ${input.sourceMediaId}, ${input.referenceMediaId ?? null},
				${input.prompt ?? 'cozy'}, ${input.kind ?? 'render'}, l.id, ${input.createdAt}, ${input.sessionId ?? null},
				${input.formSnapshot ? JSON.stringify(input.formSnapshot) : null}
			FROM ledger_entries l WHERE l.id = last_insert_rowid() AND changes() = 1 AND l.user_id = ${input.userId}`)
	]);
}
