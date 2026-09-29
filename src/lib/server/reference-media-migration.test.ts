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

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { TEST_S3_BUCKET } from './testing/generation-fixtures';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);
const MIGRATION = '0019_generation_reference_media.sql';

function readMigration(file: string): string {
	return readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8');
}

function makeDatabase(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const file of readdirSync(MIGRATIONS_DIR)
		.filter((name) => name.endsWith('.sql'))
		.sort()) {
		if (file === MIGRATION) break;
		db.exec(readMigration(file));
	}
	return db;
}

function insertMedia(db: DatabaseSync, filename: string): number {
	return Number(
		db.prepare("INSERT INTO media (filename, bucket, checksum) VALUES (?, 1, '')").run(filename)
			.lastInsertRowid
	);
}

function insertGeneration(
	db: DatabaseSync,
	id: string,
	kind: string,
	sourceMediaId: number,
	formSnapshot: unknown = null
): void {
	const resultMediaId = insertMedia(db, `${id}-result.webp`);
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at, form_snapshot) ' +
			"VALUES (?, 'user-1', ?, ?, '', ?, 1, 9, 1, ?)"
	).run(
		id,
		resultMediaId,
		sourceMediaId,
		kind,
		formSnapshot === null
			? null
			: typeof formSnapshot === 'string'
				? formSnapshot
				: JSON.stringify(formSnapshot)
	);
}

function insertCompletedJob(
	db: DatabaseSync,
	table: 'object_replacement_jobs' | 'texture_replacement_jobs',
	id: string,
	sceneMediaId: number,
	referenceMediaId: number
): void {
	const outputMediaId = insertMedia(db, `${id}-output.webp`);
	const detail = table === 'object_replacement_jobs' ? 'replacement_object' : 'replacement_surface';
	db.prepare(
		`INSERT INTO ${table} ` +
			`(id, user_id, comfy_prompt_id, scene_media_id, reference_media_id, ${detail}, cost, status, output_media_id, balance_after, created_at, updated_at, completed_at) ` +
			"VALUES (?, 'user-1', ?, ?, ?, 'x', 1, 'completed', ?, 9, 1, 1, 1)"
	).run(id, `prompt-${id}`, sceneMediaId, referenceMediaId, outputMediaId);
}

function referenceOf(db: DatabaseSync, id: string): number | null {
	const row = db.prepare('SELECT reference_media_id FROM generations WHERE id = ?').get(id) as {
		reference_media_id: number | null;
	};
	return row.reference_media_id;
}

describe('0019 generation reference media migration', () => {
	it('backfills every reference a past generation was made with', () => {
		const db = makeDatabase();
		db.prepare('INSERT INTO buckets (name, url) VALUES (?, ?)').run(
			TEST_S3_BUCKET.name,
			'https://uploads.example.test'
		);
		db.prepare("INSERT INTO users (id, pubkey, created_at) VALUES ('user-1', 'pubkey-1', 1)").run();
		const scene = insertMedia(db, 'scene.jpg');
		const chair = insertMedia(db, 'chair.png');
		const wood = insertMedia(db, 'wood.png');
		const style = insertMedia(db, 'style.jpg');

		insertCompletedJob(db, 'object_replacement_jobs', 'object-1', scene, chair);
		insertGeneration(db, 'object-1', 'object-replacement', scene);
		insertCompletedJob(db, 'texture_replacement_jobs', 'texture-1', scene, wood);
		insertGeneration(db, 'texture-1', 'texture-replacement', scene);
		insertGeneration(db, 'style-custom', 'style-transfer', scene, {
			styleReferenceImage: { mediaKey: `${TEST_S3_BUCKET.name}/style.jpg` }
		});
		insertGeneration(db, 'style-preset', 'style-transfer', scene, {
			styleReferenceImage: { stylePresetId: 'interior-watercolor-v1' }
		});
		insertGeneration(db, 'style-legacy', 'style-transfer', scene);
		// migrations/0015 moved URL-only media into 'external:<origin>' buckets,
		// whose names mediaKey URI-encodes.
		db.prepare(
			"INSERT INTO buckets (name, url) VALUES ('external:https://cdn.example.test', 'https://cdn.example.test')"
		).run();
		const externalStyle = Number(
			db
				.prepare(
					"INSERT INTO media (filename, bucket, checksum) VALUES ('legacy/style.jpg', 2, '')"
				)
				.run().lastInsertRowid
		);
		insertGeneration(db, 'style-external', 'style-transfer', scene, {
			styleReferenceImage: {
				mediaKey: `${encodeURIComponent('external:https://cdn.example.test')}/legacy/style.jpg`
			}
		});
		// Malformed JSON must not fail the whole migration (json_extract raises
		// on it) — the row just keeps no reference.
		insertGeneration(db, 'style-malformed', 'style-transfer', scene, '{not json');
		insertGeneration(db, 'render-1', 'render', scene);

		db.exec(readMigration(MIGRATION));

		expect(referenceOf(db, 'object-1')).toBe(chair);
		expect(referenceOf(db, 'texture-1')).toBe(wood);
		expect(referenceOf(db, 'style-custom')).toBe(style);
		expect(referenceOf(db, 'style-external')).toBe(externalStyle);
		expect(referenceOf(db, 'style-preset')).toBeNull();
		expect(referenceOf(db, 'style-legacy')).toBeNull();
		expect(referenceOf(db, 'style-malformed')).toBeNull();
		expect(referenceOf(db, 'render-1')).toBeNull();
	});
});
