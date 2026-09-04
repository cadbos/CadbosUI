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

const MIGRATIONS_DIR = new URL('../../../../drizzle/', import.meta.url);
const SCHEMA = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort()
	.map((directory) => readFileSync(new URL(`${directory}/migration.sql`, MIGRATIONS_DIR), 'utf8'))
	.join('\n');

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
	db.exec(SCHEMA.replaceAll('--> statement-breakpoint', ''));
	db.exec(
		"INSERT INTO buckets (name, url) VALUES ('cadbos-uploads', 'https://uploads.cadbos.example')"
	);
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
		raw: async () =>
			(db.prepare(sql).all(...args) as Record<string, unknown>[]).map((row) => Object.values(row)),
		sql,
		args
	});
	return {
		prepare: (sql: string) => stmt(sql),
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
	} as unknown as D1Database;
}

export function makeDb(): Database {
	return createDb(makeD1());
}
