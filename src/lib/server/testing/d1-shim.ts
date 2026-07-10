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
import { toLedgerAmountUnits } from '$lib/server/ledger-units';

const MIGRATIONS_DIR = new URL('../../../../migrations/', import.meta.url);
// Mirrors `wrangler d1 migrations apply`: every *.sql file in the migrations
// dir, applied in filename order.
const SCHEMA = readdirSync(MIGRATIONS_DIR)
	.filter((file) => file.endsWith('.sql'))
	.sort()
	.map((file) => readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'))
	.join('\n');

interface ShimStatement {
	bind: (...next: SQLInputValue[]) => ShimStatement;
	run: () => { success: true; meta: { changes: number } };
	first: (col?: string) => unknown;
	all: () => { results: Record<string, unknown>[] };
	sql: string;
	args: SQLInputValue[];
}

export function makeD1(): D1Database {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec(SCHEMA);
	const stmt = (sql: string, args: SQLInputValue[] = []): ShimStatement => ({
		bind: (...next: SQLInputValue[]) => stmt(sql, next),
		run: () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
		first: (col?: string) => {
			const row = db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
			if (row === undefined) return null;
			return col ? row[col] : row;
		},
		all: () => ({ results: db.prepare(sql).all(...args) as Record<string, unknown>[] }),
		sql,
		args
	});
	return {
		prepare: (sql: string) => stmt(sql),
		// Mirrors D1's batch(): every statement commits or rolls back together.
		batch: (statements: ShimStatement[]) => {
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

export function grantGenerationAccess(
	db: D1Database,
	userId: string,
	balance: number,
	enabled: 0 | 1 = 1,
	occurredAt = Date.now()
): void {
	const accountId = `app-credit:${userId}`;
	db.prepare('INSERT INTO ledger_accounts (id, asset, user_id, created_at) VALUES (?, ?, ?, ?)')
		.bind(accountId, 'app_credit', userId, occurredAt)
		.run();

	if (balance !== 0) {
		const transactionId = `opening:${accountId}`;
		db.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)')
			.bind(transactionId, occurredAt)
			.run();
		db.prepare('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)')
			.bind(transactionId, accountId, toLedgerAmountUnits(balance))
			.run();
		db.prepare('INSERT INTO ledger_openings (account_id, transaction_id) VALUES (?, ?)')
			.bind(accountId, transactionId)
			.run();
		db.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?')
			.bind(transactionId)
			.run();
	}

	db.prepare('INSERT INTO generation_access (user_id, enabled) VALUES (?, ?)')
		.bind(userId, enabled)
		.run();
}

export function seedGeneratedImage(
	db: D1Database,
	id: string,
	userId: string,
	createdAt: number,
	url = `https://cdn.example.test/${id}.webp`
): void {
	const transactionId = `generation:${id}`;
	db.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)')
		.bind(transactionId, createdAt)
		.run();
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, prompt, kind, ledger_transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	)
		.bind(id, userId, 'cozy', 'render', transactionId, createdAt)
		.run();
	db.prepare(
		'INSERT INTO image_generation_details (generation_id, output_url, input_url) VALUES (?, ?, ?)'
	)
		.bind(id, url, 'https://cdn.example.test/source.jpg')
		.run();
	db.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?').bind(transactionId).run();
}
