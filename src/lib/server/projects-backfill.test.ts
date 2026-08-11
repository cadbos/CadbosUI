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

// Exercises the migrations/0011_projects.sql backfill in isolation. The shared D1
// test shim (./testing/d1-shim.ts) applies every migration at db-creation time,
// which is too late to seed pre-Module-11 data before 0011 runs — so this test
// replays migrations up to 0010 raw, seeds data the way it would have existed in
// production, then applies 0011 alone and asserts the backfill invariants.

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);
const MIGRATION_UNDER_TEST = '0011_projects.sql';

function migrationFiles(): string[] {
	return readdirSync(MIGRATIONS_DIR)
		.filter((file) => file.endsWith('.sql'))
		.sort();
}

function readMigration(file: string): string {
	return readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8');
}

function makePreBackfillDb(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const file of migrationFiles()) {
		if (file === MIGRATION_UNDER_TEST) break;
		db.exec(readMigration(file));
	}
	return db;
}

function applyMigrationUnderTest(db: DatabaseSync): void {
	db.exec(readMigration(MIGRATION_UNDER_TEST));
}

function seedUser(db: DatabaseSync, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)').run(
		id,
		pubkey,
		Date.now()
	);
}

function seedGeneration(
	db: DatabaseSync,
	id: string,
	userId: string,
	sourceUrl: string,
	sourceHash: string,
	createdAt: number
): void {
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, url, source_url, source_hash, prompt, kind, amount, balance_after, created_at) ' +
			"VALUES (?, ?, ?, ?, ?, 'cozy', 'render', 1, 10, ?)"
	).run(id, userId, `https://cdn.example.test/${id}.webp`, sourceUrl, sourceHash, createdAt);
}

type JobStatus = 'processing' | 'completed' | 'failed';

function seedObjectReplacementJob(
	db: DatabaseSync,
	id: string,
	userId: string,
	status: JobStatus,
	now: number
): void {
	if (status === 'completed') {
		db.prepare(
			'INSERT INTO object_replacement_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_object, cost, status, output_url, balance_after, created_at, updated_at, completed_at) ' +
				"VALUES (?, ?, ?, 'https://cdn.example.test/scene.jpg', 'https://cdn.example.test/ref.jpg', 'chair', 1, 'completed', 'https://cdn.example.test/out.webp', 10, ?, ?, ?)"
		).run(id, userId, `${id}-prompt`, now, now, now);
		return;
	}
	if (status === 'failed') {
		db.prepare(
			'INSERT INTO object_replacement_jobs ' +
				'(id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_object, cost, status, error_code, created_at, updated_at, completed_at) ' +
				"VALUES (?, ?, ?, 'https://cdn.example.test/scene.jpg', 'https://cdn.example.test/ref.jpg', 'chair', 1, 'failed', 'boom', ?, ?, ?)"
		).run(id, userId, `${id}-prompt`, now, now, now);
		return;
	}
	db.prepare(
		'INSERT INTO object_replacement_jobs ' +
			'(id, user_id, comfy_prompt_id, scene_url, reference_url, replacement_object, cost, status, created_at, updated_at) ' +
			"VALUES (?, ?, ?, 'https://cdn.example.test/scene.jpg', 'https://cdn.example.test/ref.jpg', 'chair', 1, 'processing', ?, ?)"
	).run(id, userId, `${id}-prompt`, now, now);
}

function untitledSessionId(db: DatabaseSync, userId: string): string {
	const row = db
		.prepare(
			'SELECT ps.id AS id FROM project_sessions ps ' +
				'JOIN projects p ON p.id = ps.project_id WHERE p.user_id = ?'
		)
		.get(userId) as { id: string } | undefined;
	if (!row) throw new Error(`no backfilled project/session for ${userId}`);
	return row.id;
}

describe('0011_projects backfill', () => {
	let db: DatabaseSync;

	beforeEach(() => {
		db = makePreBackfillDb();
	});

	it('creates one Untitled project+session per user and attaches every generation to it', () => {
		const now = Date.now();
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneration(db, 'gen-1', 'user-1', 'https://cdn.example.test/room-a.jpg', 'hash-a', now);
		seedGeneration(db, 'gen-2', 'user-1', 'https://cdn.example.test/gen-1.webp', '', now + 1);
		seedGeneration(db, 'gen-3', 'user-2', 'https://cdn.example.test/room-b.jpg', 'hash-b', now);

		applyMigrationUnderTest(db);

		const projects = db.prepare('SELECT id, user_id FROM projects').all() as {
			id: string;
			user_id: string;
		}[];
		expect(projects).toHaveLength(2);

		const session1 = untitledSessionId(db, 'user-1');
		const session2 = untitledSessionId(db, 'user-2');
		expect(session1).not.toBe(session2);

		const generations = db.prepare('SELECT id, user_id, session_id FROM generations').all() as {
			id: string;
			user_id: string;
			session_id: string | null;
		}[];
		for (const generation of generations) {
			const expected = generation.user_id === 'user-1' ? session1 : session2;
			expect(generation.session_id).toBe(expected);
		}
	});

	// Regression test: the backfill originally minted ids as
	// lower(hex(randomblob(16))) — 32 raw hex characters with no dashes and no
	// version/variant nibbles, which is not a value z.uuid() accepts. The
	// client validates GET /api/projects and GET /api/projects/[id] responses
	// with z.uuid(), so a malformed id here doesn't just look odd — it makes
	// the *entire* projects list fail to load for that account, not just the
	// one bad row (see migrations/0013_fix_backfill_uuid_format.sql).
	it('mints backfilled project and session ids as real UUIDs, not raw hex', () => {
		const now = Date.now();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'gen-1', 'user-1', 'https://cdn.example.test/room-a.jpg', 'hash-a', now);

		applyMigrationUnderTest(db);

		const project = db.prepare('SELECT id FROM projects WHERE user_id = ?').get('user-1') as {
			id: string;
		};
		const session = db
			.prepare('SELECT id FROM project_sessions WHERE project_id = ?')
			.get(project.id) as { id: string };

		expect(z.uuid().safeParse(project.id).success).toBe(true);
		expect(z.uuid().safeParse(session.id).success).toBe(true);
	});

	it('backfills a completed job from its matching generation, and processing/failed jobs from the Untitled session', () => {
		const now = Date.now();
		seedUser(db, 'user-1', 'pubkey-1');
		seedGeneration(db, 'job-done', 'user-1', 'https://cdn.example.test/room-a.jpg', 'hash-a', now);
		seedObjectReplacementJob(db, 'job-done', 'user-1', 'completed', now);
		seedObjectReplacementJob(db, 'job-pending', 'user-1', 'processing', now);
		seedObjectReplacementJob(db, 'job-broken', 'user-1', 'failed', now);

		applyMigrationUnderTest(db);

		const expectedSession = untitledSessionId(db, 'user-1');
		const jobs = db
			.prepare('SELECT id, session_id FROM object_replacement_jobs ORDER BY id')
			.all() as { id: string; session_id: string | null }[];

		for (const job of jobs) {
			expect(job.session_id).toBe(expectedSession);
		}
	});

	it('creates a project/session for a user who only has an incomplete job, no generations at all', () => {
		const now = Date.now();
		seedUser(db, 'user-3', 'pubkey-3');
		seedObjectReplacementJob(db, 'job-only', 'user-3', 'processing', now);

		applyMigrationUnderTest(db);

		const session = untitledSessionId(db, 'user-3');
		const job = db
			.prepare('SELECT session_id FROM object_replacement_jobs WHERE id = ?')
			.get('job-only') as { session_id: string | null };
		expect(job.session_id).toBe(session);
	});

	it("never merges two different users into the same session, even when both share source_hash = ''", () => {
		const now = Date.now();
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneration(db, 'gen-1', 'user-1', 'https://cdn.example.test/shared-preset.jpg', '', now);
		seedGeneration(db, 'gen-2', 'user-2', 'https://cdn.example.test/shared-preset.jpg', '', now);

		applyMigrationUnderTest(db);

		const session1 = untitledSessionId(db, 'user-1');
		const session2 = untitledSessionId(db, 'user-2');
		expect(session1).not.toBe(session2);
	});

	it('is a no-op on an empty database (mirrors makeD1(), which applies this migration with nothing seeded yet)', () => {
		applyMigrationUnderTest(db);

		const projects = db.prepare('SELECT COUNT(*) AS count FROM projects').get() as {
			count: number;
		};
		expect(projects.count).toBe(0);
	});
});
