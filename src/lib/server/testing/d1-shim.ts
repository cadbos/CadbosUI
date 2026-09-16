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

// Minimal D1Database shim over node:sqlite, shared by server-side tests that need
// to exercise real SQL (atomic upserts, RETURNING, UNIQUE constraints) against the
// server schema without a Workers runtime. Test-only — never imported from
// production code.

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import { createDb, type Database } from '$lib/server/db';
import { TEST_S3_BUCKET } from './generation-fixtures';

const MIGRATIONS_DIR = new URL('../../../../migrations/', import.meta.url);
const SCHEMA = readdirSync(MIGRATIONS_DIR)
	.filter((file) => file.endsWith('.sql'))
	.sort()
	.map((file) => readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'))
	.join('\n');

interface SyncStatement {
	bind: (...next: SQLInputValue[]) => SyncStatement;
	run: () => { success: true; meta: { changes: number } };
	first: <T = Record<string, unknown>>(col?: string) => T | null;
	all: <T = Record<string, unknown>>() => { results: T[] };
}

interface TestBinding extends D1Database {
	prepareSync: (query: string) => SyncStatement;
}

export type TestDatabase = Database & { prepare: TestBinding['prepareSync'] };

interface ShimStatement {
	bind: (...next: SQLInputValue[]) => ShimStatement;
	run: () => Promise<{ success: true; meta: { changes: number } }>;
	first: (col?: string) => Promise<unknown>;
	all: () => Promise<{ results: Record<string, unknown>[] }>;
	raw: () => Promise<unknown[][]>;
	sql: string;
	args: SQLInputValue[];
}

export function makeD1(): D1Database {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec(SCHEMA);
	db.prepare('INSERT INTO buckets (name, url) VALUES (?, ?)').run(
		TEST_S3_BUCKET.name,
		'https://uploads.cadbos.example'
	);
	const syncStmt = (query: string, args: SQLInputValue[] = []): SyncStatement => ({
		bind: (...next: SQLInputValue[]) => syncStmt(query, next),
		run: () => ({
			success: true,
			meta: { changes: Number(db.prepare(query).run(...args).changes) }
		}),
		first: <T>(col?: string): T | null => {
			const row = db.prepare(query).get(...args) as Record<string, unknown> | undefined;
			return (row === undefined ? null : col ? row[col] : row) as T | null;
		},
		all: <T>(): { results: T[] } => ({ results: db.prepare(query).all(...args) as T[] })
	});
	const stmt = (sql: string, args: SQLInputValue[] = []): ShimStatement => ({
		bind: (...next: SQLInputValue[]) => stmt(sql, next),
		run: async () => ({
			success: true,
			meta: { changes: Number(db.prepare(sql).run(...args).changes) }
		}),
		first: async (col?: string) => {
			const row = db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
			if (row === undefined) return null;
			return col ? row[col] : row;
		},
		all: async () => ({ results: db.prepare(sql).all(...args) as Record<string, unknown>[] }),
		raw: async () => {
			const raw = db.prepare(sql);
			raw.setReturnArrays(true);
			return raw.all(...args) as unknown as unknown[][];
		},
		sql,
		args
	});
	return {
		prepare: (sql: string) => stmt(sql),
		prepareSync: (query: string) => syncStmt(query),
		// Mirrors D1's batch(): every statement commits or rolls back together.
		batch: async (statements: ShimStatement[]) => {
			db.exec('BEGIN');
			try {
				const results = statements.map((statement) => ({
					results: db.prepare(statement.sql).all(...statement.args) as Record<string, unknown>[],
					success: true as const,
					meta: {}
				}));
				db.exec('COMMIT');
				return results;
			} catch (err) {
				db.exec('ROLLBACK');
				throw err;
			}
		}
	} as unknown as TestBinding;
}

export function makeDb(): TestDatabase {
	const binding = makeD1() as TestBinding;
	return Object.assign(createDb(binding), { prepare: binding.prepareSync });
}
