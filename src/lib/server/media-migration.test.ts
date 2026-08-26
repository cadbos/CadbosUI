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

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);
const MIGRATION = '0015_media.sql';

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

describe('0015 media migration', () => {
	it('moves every image reference to media and sanitizes historical checksums', () => {
		const db = makeDatabase();
		const now = Date.now();
		db.prepare(
			"INSERT INTO buckets (name, url) VALUES ('cadbos-uploads', 'https://uploads.example.test')"
		).run();
		db.prepare(
			"INSERT INTO buckets (name, url) VALUES ('cadbos-style-presets', 'https://presets.example.test')"
		).run();
		db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)').run(
			'user-1',
			'pubkey-1',
			now
		);
		db.prepare(
			'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
		).run('project-1', 'user-1', 'Project', now, now);
		db.prepare(
			'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
		).run('session-1', 'project-1', 'Session', now, now);

		const generation = db.prepare(
			'INSERT INTO generations ' +
				'(id, user_id, url, source_url, source_hash, prompt, kind, amount, balance_after, created_at, session_id) ' +
				"VALUES (?, 'user-1', ?, ?, ?, 'prompt', 'render', 1, 9, ?, 'session-1')"
		);
		generation.run(
			'generation-1',
			'https://uploads.example.test/result-1.webp',
			'https://uploads.example.test/source-a.jpg',
			'A'.repeat(64),
			now
		);
		generation.run(
			'generation-2',
			'https://uploads.example.test/result-2.webp',
			'https://uploads.example.test/source-b.jpg',
			'B'.repeat(64),
			now + 1
		);
		db.prepare(
			'INSERT INTO project_sessions ' +
				'(id, project_id, title, parent_session_id, forked_from_generation_id, created_at, updated_at) ' +
				"VALUES ('session-2', 'project-1', 'Fork', 'session-1', 'generation-1', ?, ?)"
		).run(now, now);

		db.prepare(
			'INSERT INTO object_replacement_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_object, cost, status, created_at, updated_at, scene_hash, session_id) ' +
				"VALUES ('object-1', 'user-1', 'prompt-1', ?, ?, 'chair', 1, 'processing', ?, ?, ?, 'session-1')"
		).run(
			'https://uploads.example.test/source-b.jpg',
			'https://refs.example.test/chair.png',
			now,
			now,
			'C'.repeat(64)
		);
		db.prepare(
			'INSERT INTO texture_replacement_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_surface, cost, status, output_url, balance_after, created_at, updated_at, completed_at, scene_hash, session_id) ' +
				"VALUES ('texture-1', 'user-1', 'prompt-2', ?, ?, 'wood', 1, 'completed', ?, 8, ?, ?, ?, 'not-hex', 'session-1')"
		).run(
			'https://scene.example.test/room.jpg',
			'https://refs.example.test/wood.png',
			'https://results.example.test/wood.webp',
			now,
			now,
			now
		);
		db.prepare(
			'INSERT INTO light_settings_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_url, scene_hash, session_id, instruction, cost, status, output_url, balance_after, created_at, updated_at, completed_at) ' +
				"VALUES ('light-1', 'user-1', 'prompt-3', ?, ?, 'session-1', 'warmer', 1, 'completed', ?, 7, ?, ?, ?)"
		).run(
			'https://uploads.example.test/light-source.jpg',
			'D'.repeat(64),
			'https://results.example.test/light.webp',
			now,
			now,
			now
		);

		db.exec(`BEGIN TRANSACTION;\n${readMigration(MIGRATION)}\nCOMMIT;`);

		for (const table of [
			'generations',
			'object_replacement_jobs',
			'texture_replacement_jobs',
			'light_settings_jobs'
		]) {
			const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
			expect(columns.some((column) => column.name.endsWith('_url'))).toBe(false);
			expect(columns.some((column) => column.name.endsWith('_hash'))).toBe(false);
		}
		expect(db.prepare("SELECT checksum FROM media WHERE filename = 'source-a.jpg'").get()).toEqual({
			checksum: 'a'.repeat(64)
		});
		expect(db.prepare("SELECT checksum FROM media WHERE filename = 'source-b.jpg'").get()).toEqual({
			checksum: ''
		});
		expect(db.prepare("SELECT checksum FROM media WHERE filename = 'room.jpg'").get()).toEqual({
			checksum: ''
		});
		expect(
			db.prepare("SELECT checksum FROM media WHERE filename = 'light-source.jpg'").get()
		).toEqual({ checksum: 'd'.repeat(64) });
		expect(
			db.prepare("SELECT COUNT(*) AS count FROM buckets WHERE name LIKE 'external:%'").get()
		).toEqual({ count: 3 });
		expect(db.prepare('SELECT COUNT(*) AS count FROM generations').get()).toEqual({ count: 2 });
		expect(db.prepare('SELECT COUNT(*) AS count FROM project_sessions').get()).toEqual({
			count: 2
		});
		expect(
			db
				.prepare("SELECT forked_from_generation_id FROM project_sessions WHERE id = 'session-2'")
				.get()
		).toEqual({ forked_from_generation_id: 'generation-1' });
		expect(db.prepare('SELECT COUNT(*) AS count FROM object_replacement_jobs').get()).toEqual({
			count: 1
		});
		expect(db.prepare('SELECT COUNT(*) AS count FROM texture_replacement_jobs').get()).toEqual({
			count: 1
		});
		expect(db.prepare('SELECT COUNT(*) AS count FROM light_settings_jobs').get()).toEqual({
			count: 1
		});
		expect(
			db
				.prepare(
					"SELECT source_bucket.url || '/' || source.filename AS source_url, " +
						"result_bucket.url || '/' || result.filename AS result_url " +
						'FROM generations ' +
						'JOIN media source ON source.id = generations.source_media_id ' +
						'JOIN buckets source_bucket ON source_bucket.id = source.bucket ' +
						'JOIN media result ON result.id = generations.result_media_id ' +
						'JOIN buckets result_bucket ON result_bucket.id = result.bucket ' +
						"WHERE generations.id = 'generation-1'"
				)
				.get()
		).toEqual({
			source_url: 'https://uploads.example.test/source-a.jpg',
			result_url: 'https://uploads.example.test/result-1.webp'
		});
		expect(
			db
				.prepare(
					"SELECT scene_bucket.url || '/' || scene.filename AS scene_url, " +
						"reference_bucket.url || '/' || reference.filename AS reference_url, " +
						"output_bucket.url || '/' || output.filename AS output_url " +
						'FROM texture_replacement_jobs ' +
						'JOIN media scene ON scene.id = texture_replacement_jobs.scene_media_id ' +
						'JOIN buckets scene_bucket ON scene_bucket.id = scene.bucket ' +
						'JOIN media reference ON reference.id = texture_replacement_jobs.reference_media_id ' +
						'JOIN buckets reference_bucket ON reference_bucket.id = reference.bucket ' +
						'JOIN media output ON output.id = texture_replacement_jobs.output_media_id ' +
						'JOIN buckets output_bucket ON output_bucket.id = output.bucket ' +
						"WHERE texture_replacement_jobs.id = 'texture-1'"
				)
				.get()
		).toEqual({
			scene_url: 'https://scene.example.test/room.jpg',
			reference_url: 'https://refs.example.test/wood.png',
			output_url: 'https://results.example.test/wood.webp'
		});
		expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
	});

	it.each([
		{ wildcard: '_', bucketUrl: 'https://literal.example/a_b' },
		{ wildcard: '%', bucketUrl: 'https://literal.example/a%b' }
	])('treats $wildcard in bucket URLs literally', ({ bucketUrl }) => {
		const db = makeDatabase();
		db.prepare('INSERT INTO buckets (name, url) VALUES (?, ?)').run('wildcard', bucketUrl);
		db.prepare(
			"INSERT INTO users (id, pubkey, created_at) VALUES ('user-literal', 'pubkey-literal', 1)"
		).run();
		db.prepare(
			'INSERT INTO generations ' +
				'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
				"VALUES ('generation-literal', 'user-literal', ?, ?, 'prompt', 'render', 1, 9, 1)"
		).run('https://literal.example/axb/result.webp', 'https://literal.example/axb/source.jpg');

		db.exec(readMigration(MIGRATION));

		expect(
			db
				.prepare(
					'SELECT buckets.url AS bucket_url, media.filename ' +
						'FROM generations ' +
						'JOIN media ON media.id = generations.result_media_id ' +
						'JOIN buckets ON buckets.id = media.bucket'
				)
				.get()
		).toEqual({ bucket_url: 'https://literal.example', filename: 'axb/result.webp' });
	});

	it.each([
		{
			table: 'generations',
			insert:
				"INSERT INTO generations (id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) VALUES ('generation-guard', 'user-guard', 'https://missing.example/result.webp', 'https://source.example/source.jpg', 'prompt', 'render', 1, 9, 1)"
		},
		{
			table: 'object_replacement_jobs',
			insert:
				"INSERT INTO object_replacement_jobs (id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_object, cost, status, created_at, updated_at) VALUES ('object-guard', 'user-guard', 'prompt-object', 'https://source.example/scene.jpg', 'https://missing.example/reference.png', 'chair', 1, 'processing', 1, 1)"
		},
		{
			table: 'texture_replacement_jobs',
			insert:
				"INSERT INTO texture_replacement_jobs (id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_surface, cost, status, created_at, updated_at) VALUES ('texture-guard', 'user-guard', 'prompt-texture', 'https://source.example/scene.jpg', 'https://missing.example/reference.png', 'wood', 1, 'processing', 1, 1)"
		},
		{
			table: 'light_settings_jobs',
			insert:
				"INSERT INTO light_settings_jobs (id, user_id, comfy_prompt_id, scene_url, instruction, cost, status, created_at, updated_at) VALUES ('light-guard', 'user-guard', 'prompt-light', 'https://missing.example/scene.jpg', 'warmer', 1, 'processing', 1, 1)"
		}
	])('aborts when $table loses a required media mapping', ({ table, insert }) => {
		const db = makeDatabase();
		db.prepare(
			"INSERT INTO users (id, pubkey, created_at) VALUES ('user-guard', 'pubkey-guard', 1)"
		).run();
		db.prepare(
			"INSERT INTO buckets (name, url) VALUES ('external:https://missing.example', 'https://unrelated.example')"
		).run();
		db.exec(insert);

		db.exec('BEGIN TRANSACTION');
		expect(() => db.exec(readMigration(MIGRATION))).toThrow(/CHECK constraint failed/);
		db.exec('ROLLBACK');

		expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 1 });
	});
});
