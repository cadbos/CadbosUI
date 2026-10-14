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

const MIGRATIONS = new URL('../../../migrations/', import.meta.url);
const LEDGER_MIGRATION = '0024_ledger_entries.sql';

function migration(name: string): string {
	return readFileSync(new URL(name, MIGRATIONS), 'utf8');
}

function previousDatabase(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const name of readdirSync(MIGRATIONS)
		.filter((name) => name.endsWith('.sql'))
		.sort()) {
		if (name === LEDGER_MIGRATION) break;
		db.exec(migration(name));
	}
	db.exec(`INSERT INTO users (id, pubkey, created_at) VALUES ('user-1', 'pubkey-1', 1), ('user-2', 'pubkey-2', 1), ('user-3', 'pubkey-3', 1);
        INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES ('user-1', 12, 30, 1), ('user-2', 0, 30, 0), ('user-3', -0.01, 30, 1);
        INSERT INTO buckets (name, url) VALUES ('cadbos-uploads', 'https://uploads.example.test');
        INSERT INTO media (id, filename, bucket, checksum) VALUES (1, 'source.webp', 1, ''), (2, 'reference.webp', 1, ''), (3, 'result.webp', 1, '');
        INSERT INTO generations (id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at)
            VALUES ('job-1', 'user-1', 3, 1, 'sofa', 'object-replacement', 0.03, 11.97, 20);
        INSERT INTO object_replacement_jobs (id, user_id, comfy_prompt_id, scene_media_id, reference_media_id, replacement_object, cost, status, output_media_id, balance_after, created_at, updated_at, completed_at)
            VALUES ('job-1', 'user-1', 'prompt-1', 1, 2, 'sofa', 0.03, 'completed', 3, 11.97, 10, 20, 20);`);
	return db;
}

describe('ledger migrations', () => {
	it('preserves account totals, historical generation balances, completed jobs and foreign keys', () => {
		const db = previousDatabase();
		try {
			db.exec(migration(LEDGER_MIGRATION));
			expect(
				db
					.prepare(
						"SELECT user_id, SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END) AS cents FROM ledger_entries GROUP BY user_id ORDER BY user_id"
					)
					.all()
			).toEqual([
				{ user_id: 'user-1', cents: 1200 },
				{ user_id: 'user-3', cents: -1 }
			]);
			expect(db.prepare('SELECT * FROM credits ORDER BY user_id').all()).toEqual([
				{ user_id: 'user-1', enabled: 1 },
				{ user_id: 'user-2', enabled: 0 },
				{ user_id: 'user-3', enabled: 1 }
			]);
			expect(
				db
					.prepare(
						"SELECT l.amount, l.entry_side, l.reason, g.id AS generation_id FROM generations g JOIN ledger_entries l ON l.id = g.ledger_entry_id WHERE g.id = 'job-1'"
					)
					.get()
			).toEqual({
				amount: 3,
				entry_side: 'debit',
				reason: 'generation-charge',
				generation_id: 'job-1'
			});
			expect(
				db
					.prepare(
						"SELECT SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END) AS cents FROM ledger_entries WHERE user_id = 'user-1' AND id <= (SELECT ledger_entry_id FROM generations WHERE id = 'job-1')"
					)
					.get()
			).toEqual({ cents: 1197 });
			expect(
				db
					.prepare("SELECT status, output_media_id FROM object_replacement_jobs WHERE id = 'job-1'")
					.get()
			).toEqual({ status: 'completed', output_media_id: 3 });
			expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
			expect(
				db
					.prepare(
						"EXPLAIN QUERY PLAN SELECT SUM(amount) FROM ledger_entries WHERE user_id = 'user-1' AND id <= 2"
					)
					.all()
					.some((row) => String(row.detail).includes('ledger_entries_user_id_id'))
			).toBe(true);
		} finally {
			db.close();
		}
	});

	it('stores no operation reference in the ledger and rejects invalid generation payments', () => {
		const db = previousDatabase();
		try {
			db.exec(migration(LEDGER_MIGRATION));
			expect(
				db
					.prepare('PRAGMA table_info(ledger_entries)')
					.all()
					.map((row) => row.name)
			).toEqual(['id', 'user_id', 'amount', 'entry_side', 'reason', 'created_at']);
			db.exec(
				"INSERT INTO ledger_entries (user_id, amount, entry_side, reason) VALUES ('user-2', 1, 'debit', 'adjustment')"
			);
			for (const reference of [
				'NULL',
				'999999',
				"(SELECT id FROM ledger_entries WHERE user_id = 'user-2')",
				"(SELECT id FROM ledger_entries WHERE entry_side = 'credit' LIMIT 1)"
			]) {
				expect(() =>
					db.exec(`UPDATE generations SET ledger_entry_id = ${reference} WHERE id = 'job-1'`)
				).toThrow('does not match');
			}
			expect(() =>
				db.exec(`INSERT INTO generations
				(id, user_id, result_media_id, source_media_id, prompt, kind, ledger_entry_id, created_at)
				SELECT 'duplicate', user_id, result_media_id, source_media_id, prompt, kind, ledger_entry_id, created_at
				FROM generations WHERE id = 'job-1'`)
			).toThrow('UNIQUE');
			expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
		} finally {
			db.close();
		}
	});

	it.each([
		[
			'object_replacement_jobs',
			'object-replacement',
			'reference_media_id, replacement_object',
			"2, 'sofa'"
		],
		[
			'texture_replacement_jobs',
			'texture-replacement',
			'reference_media_id, replacement_surface',
			"2, 'walls'"
		],
		['light_settings_jobs', 'light-settings', 'instruction', "'bright'"],
		['flux_kontext_edit_jobs', 'edit', 'instruction', "'cozy'"],
		['repaint_jobs', 'repaint', 'target, color', "'walls', '#a3b19b'"]
	])(
		'keeps %s independent of debits when generation history is deleted',
		(table, kind, columns, values) => {
			const db = previousDatabase();
			try {
				db.prepare(
					`INSERT INTO generations
				(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at)
				VALUES ('completed-job', 'user-1', 3, 1, 'cozy', ?, 0.03, 11.94, 21)`
				).run(kind);
				db.exec(`INSERT INTO ${table}
				(id, user_id, comfy_prompt_id, scene_media_id, ${columns}, cost, status, output_media_id, balance_after, created_at, updated_at, completed_at)
				VALUES ('completed-job', 'user-1', 'completed-prompt', 1, ${values}, 0.03, 'completed', 3, 11.94, 10, 21, 21)`);
				db.exec(migration(LEDGER_MIGRATION));
				const payment = db
					.prepare(
						"SELECT l.* FROM generations g JOIN ledger_entries l ON l.id = g.ledger_entry_id WHERE g.id = 'completed-job'"
					)
					.get();
				expect(payment).toMatchObject({
					user_id: 'user-1',
					amount: 3,
					entry_side: 'debit',
					reason: 'generation-charge'
				});
				const job = db.prepare(`SELECT * FROM ${table} WHERE id = 'completed-job'`).get();
				expect(job).not.toHaveProperty('ledger_entry_id');
				expect(job).toMatchObject({ status: 'completed', balance_after: 11.94 });
				expect(db.prepare(`PRAGMA foreign_key_list(${table})`).all()).not.toContainEqual(
					expect.objectContaining({ table: 'ledger_entries' })
				);
				db.exec("DELETE FROM generations WHERE id = 'completed-job'");
				expect(
					db
						.prepare(
							"SELECT * FROM ledger_entries WHERE user_id = 'user-1' AND created_at = 21 AND reason = 'generation-charge'"
						)
						.get()
				).toEqual(payment);
				expect(db.prepare(`SELECT * FROM ${table} WHERE id = 'completed-job'`).get()).toEqual(job);
				expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
			} finally {
				db.close();
			}
		}
	);

	it.each([
		['object_replacement_jobs', 'reference_media_id, replacement_object', "2, 'sofa'"],
		['texture_replacement_jobs', 'reference_media_id, replacement_surface', "2, 'walls'"],
		['light_settings_jobs', 'instruction', "'bright'"],
		['flux_kontext_edit_jobs', 'instruction', "'cozy'"],
		['repaint_jobs', 'target, color', "'walls', '#a3b19b'"]
	])('preserves %s charges when generation history was deleted', (table, columns, values) => {
		for (const cost of [0.03, 0.001]) {
			const db = previousDatabase();
			try {
				const cents = Math.max(1, Math.round(cost * 100));
				for (const [id, balance, completedAt] of [
					['deleted-before', 12, 19],
					['deleted-after', 11.97 - cents / 100, 21]
				] as const) {
					db.prepare(
						`INSERT INTO ${table}
						(id, user_id, comfy_prompt_id, scene_media_id, ${columns}, cost, status, output_media_id,
						balance_after, created_at, updated_at, completed_at)
						VALUES (?, 'user-1', ?, 1, ${values}, ?, 'completed', 3, ?, 10, ?, ?)`
					).run(id, id, cost, balance, completedAt, completedAt);
				}
				const jobs = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
				const generations = db.prepare('SELECT id FROM generations ORDER BY id').all();
				db.exec(migration(LEDGER_MIGRATION));
				expect(db.prepare('SELECT id FROM generations ORDER BY id').all()).toEqual(generations);
				expect(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(jobs);
				for (const [balance, completedAt] of [
					[1200, 19],
					[1197 - cents, 21]
				] as const) {
					expect(
						db
							.prepare(
								`SELECT l.user_id, l.amount, l.entry_side, l.reason, l.created_at,
									(SELECT SUM(CASE WHEN e.entry_side = 'credit' THEN e.amount ELSE -e.amount END)
									FROM ledger_entries e WHERE e.user_id = l.user_id AND e.id <= l.id) AS balance_cents
								FROM ledger_entries l WHERE l.user_id = 'user-1' AND l.reason = 'generation-charge'
									AND l.created_at = ?`
							)
							.get(completedAt)
					).toEqual({
						user_id: 'user-1',
						amount: cents,
						entry_side: 'debit',
						reason: 'generation-charge',
						created_at: completedAt,
						balance_cents: balance
					});
				}
				expect(
					db
						.prepare(
							"SELECT SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END) AS cents FROM ledger_entries WHERE user_id = 'user-1'"
						)
						.get()
				).toEqual({ cents: 1200 });
				expect(
					db
						.prepare(
							"SELECT SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END) AS cents FROM ledger_entries WHERE user_id = 'user-1' AND id <= (SELECT ledger_entry_id FROM generations WHERE id = 'job-1')"
						)
						.get()
				).toEqual({ cents: 1197 });
				expect(() => db.exec('DELETE FROM ledger_entries')).toThrow('immutable');
				expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
				expect(
					db.prepare("SELECT name FROM sqlite_schema WHERE name GLOB '_ledger_*'").all()
				).toEqual([]);
			} finally {
				db.close();
			}
		}
	});

	it.each([
		"UPDATE object_replacement_jobs SET cost = 1e999 WHERE id = 'job-1'",
		"UPDATE object_replacement_jobs SET balance_after = 1e999 WHERE id = 'job-1'",
		"UPDATE object_replacement_jobs SET completed_at = 0 WHERE id = 'job-1'"
	])('rejects invalid completed-job accounting after generation deletion: %s', (update) => {
		const db = previousDatabase();
		try {
			db.exec("DELETE FROM generations WHERE id = 'job-1'");
			db.exec(update);
			db.exec('BEGIN');
			expect(() => db.exec(migration(LEDGER_MIGRATION))).toThrow();
			db.exec('ROLLBACK');
			expect(
				db.prepare("SELECT name FROM sqlite_schema WHERE name = 'ledger_entries'").get()
			).toBeUndefined();
			expect(db.prepare('SELECT COUNT(*) AS count FROM object_replacement_jobs').get()).toEqual({
				count: 1
			});
		} finally {
			db.close();
		}
	});

	it.each([
		"UPDATE object_replacement_jobs SET user_id = 'user-2' WHERE id = 'job-1'",
		"UPDATE object_replacement_jobs SET balance_after = 12 WHERE id = 'job-1'"
	])('rejects inconsistent completed-job accounting: %s', (update) => {
		const db = previousDatabase();
		try {
			db.exec(update);
			db.exec('BEGIN');
			expect(() => db.exec(migration(LEDGER_MIGRATION))).toThrow();
			db.exec('ROLLBACK');
			expect(
				db.prepare("SELECT name FROM sqlite_schema WHERE name = 'ledger_entries'").get()
			).toBeUndefined();
		} finally {
			db.close();
		}
	});

	it('protects immutable entries and rejects mismatched generation links', () => {
		const db = previousDatabase();
		try {
			db.exec(migration(LEDGER_MIGRATION));
			expect(() => db.exec('UPDATE ledger_entries SET amount = amount + 1')).toThrow('immutable');
			expect(() => db.exec('DELETE FROM ledger_entries')).toThrow('immutable');
			expect(() => db.exec("UPDATE generations SET user_id = 'user-2' WHERE id = 'job-1'")).toThrow(
				'does not match'
			);
			db.exec("UPDATE generations SET id = 'other-id' WHERE id = 'job-1'");
			expect(
				db.prepare("SELECT ledger_entry_id FROM generations WHERE id = 'other-id'").get()
			).toEqual({
				ledger_entry_id: expect.any(Number)
			});
			expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
		} finally {
			db.close();
		}
	});

	it.each([
		{ userId: 'user-1', kind: 'render', balance: 11.97 },
		{ userId: 'user-1', kind: 'upscale', balance: 11.97 },
		{ userId: 'user-2', kind: 'render', balance: 0 },
		{ userId: 'user-2', kind: 'upscale', balance: 0 },
		{ userId: 'user-3', kind: 'render', balance: -0.01 },
		{ userId: 'user-4', kind: 'render', balance: 4.5 }
	])('preserves zero-amount $kind history for $userId', ({ userId, kind, balance }) => {
		const db = previousDatabase();
		try {
			db.exec("INSERT INTO users (id, pubkey, created_at) VALUES ('user-4', 'pubkey-4', 1)");
			db.prepare(
				`INSERT INTO generations (id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at)
				 VALUES ('zero-amount', ?, 3, 1, 'sofa', ?, 0, ?, 20)`
			).run(userId, kind, balance);
			const access = db.prepare('SELECT user_id, enabled FROM credits ORDER BY user_id').all();
			const balances = db.prepare('SELECT user_id, balance FROM credits ORDER BY user_id').all();
			db.exec(migration(LEDGER_MIGRATION));
			expect(
				db
					.prepare(
						`SELECT l.amount, l.entry_side, l.reason, g.id AS generation_id
					FROM generations g JOIN ledger_entries l ON l.id = g.ledger_entry_id
					WHERE g.id = 'zero-amount' AND l.user_id = g.user_id`
					)
					.get()
			).toEqual({
				amount: 0,
				entry_side: 'debit',
				reason: 'generation-charge',
				generation_id: 'zero-amount'
			});
			expect(
				db
					.prepare(
						`SELECT SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END) AS cents
					FROM ledger_entries WHERE user_id = ?
					AND id <= (SELECT ledger_entry_id FROM generations WHERE id = 'zero-amount')`
					)
					.get(userId)
			).toEqual({ cents: Math.round(balance * 100) });
			expect(
				db
					.prepare(
						`SELECT c.user_id,
				COALESCE(SUM(CASE WHEN l.entry_side = 'credit' THEN l.amount ELSE -l.amount END), 0) / 100.0 AS balance
				FROM credits c LEFT JOIN ledger_entries l ON l.user_id = c.user_id GROUP BY c.user_id ORDER BY c.user_id`
					)
					.all()
			).toEqual(balances);
			expect(db.prepare('SELECT * FROM credits ORDER BY user_id').all()).toEqual(access);
			expect(db.prepare('SELECT COUNT(*) AS count FROM generations').get()).toEqual({ count: 2 });
			expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('preserves the one-cent minimum for positive sub-cent history', () => {
		const db = previousDatabase();
		try {
			db.exec("UPDATE generations SET amount = 0.001 WHERE id = 'job-1'");
			db.exec("UPDATE object_replacement_jobs SET cost = 0.001 WHERE id = 'job-1'");
			db.exec(migration(LEDGER_MIGRATION));
			expect(
				db
					.prepare(
						"SELECT l.amount FROM ledger_entries l JOIN generations g ON g.ledger_entry_id = l.id WHERE g.id = 'job-1'"
					)
					.get()
			).toEqual({ amount: 1 });
		} finally {
			db.close();
		}
	});

	it.each([-0.001, Infinity, Number.MAX_SAFE_INTEGER / 100 + 1])(
		'rejects invalid historical amount %s without committing a partial migration',
		(amount) => {
			const db = previousDatabase();
			try {
				db.prepare(
					`INSERT INTO generations
					(id, user_id, result_media_id, source_media_id, prompt, kind, amount, balance_after, created_at)
					VALUES ('invalid-amount', 'user-1', 3, 1, 'sofa', 'render', ?, 11.97, 25)`
				).run(amount);
				db.exec('BEGIN');
				expect(() => db.exec(migration(LEDGER_MIGRATION))).toThrow();
				db.exec('ROLLBACK');
				expect(
					db.prepare("SELECT name FROM sqlite_master WHERE name = 'ledger_entries'").get()
				).toBeUndefined();
				expect(
					db.prepare("SELECT amount FROM generations WHERE id = 'invalid-amount'").get()
				).toEqual({ amount });
				expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
			} finally {
				db.close();
			}
		}
	);

	it.each([
		{ cost: 2, amount: 0.03 },
		{ cost: 0.001, amount: 0 }
	])(
		'rejects inconsistent completed-job cost $cost and generation amount $amount without committing a partial migration',
		({ cost, amount }) => {
			const db = previousDatabase();
			try {
				db.prepare("UPDATE object_replacement_jobs SET cost = ? WHERE id = 'job-1'").run(cost);
				db.prepare("UPDATE generations SET amount = ? WHERE id = 'job-1'").run(amount);
				db.exec('BEGIN');
				expect(() => db.exec(migration(LEDGER_MIGRATION))).toThrow();
				db.exec('ROLLBACK');
				expect(
					db.prepare("SELECT name FROM sqlite_master WHERE name = 'ledger_entries'").get()
				).toBeUndefined();
				expect(db.prepare("SELECT balance FROM credits WHERE user_id = 'user-1'").get()).toEqual({
					balance: 12
				});
			} finally {
				db.close();
			}
		}
	);
});
