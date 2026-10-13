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
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';

const migrations = new URL('../../../migrations/', import.meta.url);
let db: DatabaseSync;
const invoiceId = '00000000-0000-4000-8000-000000000001';
function previousDatabase(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const name of readdirSync(migrations)
		.filter((name) => name.endsWith('.sql'))
		.sort()) {
		if (name === '0028_robokassa_invoice_details.sql') break;
		db.exec(readFileSync(new URL(name, migrations), 'utf8'));
	}
	db.exec(`INSERT INTO users (id, pubkey, created_at) VALUES ('u', 'p', 1);
 INSERT INTO credits (user_id, enabled) VALUES ('u', 0);
 INSERT INTO ledger_entries (user_id, amount, entry_side, reason) VALUES ('u', 123, 'credit', 'top-up');`);
	return db;
}
beforeEach(() => {
	db = previousDatabase();
	db.exec(readFileSync(new URL('0028_robokassa_invoice_details.sql', migrations), 'utf8'));
	db.prepare(
		`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at)
		VALUES (?, 'robokassa', 'u', 1, 'USD', 1)`
	).run(invoiceId);
});
afterEach(() => {
	try {
		expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {
		db.close();
	}
});
function quote(values: Record<string, string | number | null> = {}): void {
	const fields = {
		invoice_id: invoiceId,
		inv_id: 42,
		payment_url: 'https://example.com',
		rub_amount_minor: 83,
		rub_per_usd: '82.5',
		rate_as_of: 1,
		is_test: 1,
		hash_algorithm: 'md5',
		...values
	};
	const entries = Object.entries(fields);
	db.prepare(
		`INSERT INTO robokassa_invoice_details (${entries.map(([key]) => key).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`
	).run(...entries.map(([, value]) => value));
}
it('preserves populated invoices, ledger and approval', () => {
	expect(db.prepare('SELECT amount FROM ledger_entries').all()).toEqual([{ amount: 123 }]);
	expect(db.prepare('SELECT * FROM credits').all()).toEqual([{ user_id: 'u', enabled: 0 }]);
	expect(db.prepare('SELECT amount_minor, currency FROM invoices').get()).toEqual({
		amount_minor: 1,
		currency: 'USD'
	});
});
it.each(['rub_amount_minor', 'rub_per_usd', 'rate_as_of'])('requires %s', (column) => {
	expect(() => quote({ [column]: null })).toThrow();
});
it.each<Record<string, string | number | null>>([
	{ inv_id: 0 },
	{ inv_id: -1 },
	{ inv_id: 1.5 },
	{ inv_id: Number.MAX_SAFE_INTEGER + 1 },
	{ inv_id: null },
	{ rub_amount_minor: 0 },
	{ rub_amount_minor: -1 },
	{ rub_amount_minor: 1.5 },
	{ rub_amount_minor: Number.MAX_SAFE_INTEGER + 1 },
	{ rub_per_usd: '0' },
	{ rub_per_usd: '01' },
	{ rub_per_usd: '1.0' },
	{ rub_per_usd: '1e2' },
	{ rub_per_usd: '1..2' },
	{ rub_per_usd: '.5' },
	{ rub_per_usd: '5.' },
	{ rub_per_usd: 'NaN' },
	{ rub_per_usd: '-1' },
	{ rub_per_usd: '' },
	{ rate_as_of: 1.5 },
	{ is_test: 2 },
	{ hash_algorithm: 'sha1' },
	{ payment_url: '' }
])('rejects invalid quote values %j', (values) => {
	expect(() => quote(values)).toThrow();
});
it.each([
	'inv_id = 43',
	"payment_url = 'other'",
	'rub_amount_minor = 84',
	"rub_per_usd = '83'",
	'rate_as_of = 2',
	'is_test = 0',
	"hash_algorithm = 'sha256'",
	"invoice_id = '2'"
])('freezes %s', (assignment) => {
	quote();
	expect(() => db.exec(`UPDATE robokassa_invoice_details SET ${assignment}`)).toThrow('immutable');
});
it.each([
	"id = '2'",
	"payment_processor = 'other'",
	"user_id = 'other'",
	'amount_minor = 2',
	"currency = 'RUB'"
])('freezes invoice %s', (assignment) => {
	quote();
	expect(() => db.exec(`UPDATE invoices SET ${assignment}`)).toThrow('immutable');
});
it('allows cancellation and linked settlement', () => {
	quote();
	db.exec(
		"INSERT INTO ledger_entries (user_id, amount, entry_side, reason) VALUES ('u', 1, 'credit', 'top-up')"
	);
	db.exec(
		"UPDATE invoices SET status = 'cancelled'; UPDATE invoices SET status = 'paid', paid_at = 2, updated_at = MAX(updated_at, 2), ledger_entry_id = (SELECT id FROM ledger_entries WHERE amount = 1)"
	);
	expect(db.prepare('SELECT status, ledger_entry_id FROM invoices').get()).toEqual({
		status: 'paid',
		ledger_entry_id: 2
	});
});
it('preserves paid invoice history even after provider details are removed', () => {
	quote();
	db.exec(
		"INSERT INTO ledger_entries (user_id, amount, entry_side, reason) VALUES ('u', 1, 'credit', 'top-up')"
	);
	db.exec(
		"UPDATE invoices SET status = 'paid', paid_at = 2, ledger_entry_id = (SELECT id FROM ledger_entries WHERE amount = 1)"
	);
	const invoice = db.prepare('SELECT * FROM invoices').get();
	const entries = db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
	db.exec('DELETE FROM robokassa_invoice_details');
	expect(() => db.exec('UPDATE invoices SET created_at = 0')).toThrow(
		'paid invoices are immutable'
	);
	expect(() => db.exec('UPDATE invoices SET amount_minor = 2')).toThrow();
	expect(() => db.exec('DELETE FROM invoices')).toThrow('paid invoices are immutable');
	expect(db.prepare('SELECT * FROM invoices').get()).toEqual(invoice);
	expect(db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(entries);
});

it('does not add UUID format validation to invoices', () => {
	db.exec(`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at)
		VALUES ('direct-database-id', 'robokassa', 'u', 1, 'USD', 1)`);
	expect(db.prepare("SELECT id FROM invoices WHERE id = 'direct-database-id'").get()).toBeDefined();
});

it('enforces a unique provider ID and a valid one-to-one invoice reference', () => {
	quote();
	db.exec(`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at)
		VALUES ('00000000-0000-4000-8000-000000000002', 'robokassa', 'u', 1, 'USD', 1)`);
	expect(() => quote({ invoice_id: '00000000-0000-4000-8000-000000000002' })).toThrow('UNIQUE');
	expect(() => quote({ invoice_id: 'missing', inv_id: 43 })).toThrow('FOREIGN KEY');
});

function originalDatabase(): void {
	db.close();
	db = previousDatabase();
	db.exec(`INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at)
		VALUES ('1', 'robokassa', 'u', 1, 'USD', 1)`);
	db.exec(
		readFileSync(new URL('./testing/fixtures/robokassa-before-uuid.sql', import.meta.url), 'utf8')
	);
	db.exec(`INSERT INTO ledger_entries (id, user_id, amount, entry_side, reason, created_at)
		VALUES (2, 'u', 500, 'credit', 'top-up', 2);
		INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, status, created_at, updated_at, paid_at, ledger_entry_id)
		VALUES ('2', 'robokassa', 'u', 500, 'USD', 'paid', 1, 2, 2, 2),
			('3', 'robokassa', 'u', 100, 'USD', 'cancelled', 1, 2, NULL, NULL),
			('00000000-0000-4000-8000-000000000004', 'robokassa', 'u', 100, 'USD', 'open', 1, 2, NULL, NULL);
		INSERT INTO robokassa_invoice_details (invoice_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm, result_out_sum, result_fee, payer_email, payment_method, inc_curr_label)
		VALUES ('1', 'https://example.test/pay?InvId=1', 83, '82.5', 1, 1, 'md5', NULL, NULL, NULL, NULL, NULL),
			('2', 'https://example.test/pay?InvId=2', 41250, '82.5', 1, 1, 'md5', '412.50', '0.0', 'payer@example.test', 'BankCard', 'BankCardForeignPSR');`);
}

const conversion = readFileSync(
	new URL('../../../scripts/convert-invoice-ids.sql', import.meta.url),
	'utf8'
);

it('produces the same invoice schema as the committed migrations', () => {
	const migrated = new DatabaseSync(':memory:');
	try {
		migrated.exec('PRAGMA foreign_keys = ON');
		for (const name of readdirSync(migrations)
			.filter((name) => name.endsWith('.sql'))
			.sort()) {
			migrated.exec(readFileSync(new URL(name, migrations), 'utf8'));
		}
		originalDatabase();
		db.exec('BEGIN');
		db.exec(conversion);
		db.exec('COMMIT');
		const schema = `SELECT type, name, tbl_name, sql FROM sqlite_master
			WHERE tbl_name IN ('invoices', 'robokassa_invoice_details')
			ORDER BY type, name`;

		expect(db.prepare(schema).all()).toEqual(migrated.prepare(schema).all());
	} finally {
		migrated.close();
	}
});

it('converts an already-migrated database while preserving every accounting and provider field', () => {
	originalDatabase();
	const entries = db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
	const invoices = db.prepare('SELECT * FROM invoices ORDER BY rowid').all();
	const details = db.prepare('SELECT * FROM robokassa_invoice_details ORDER BY invoice_id').all();
	db.exec('BEGIN');
	db.exec(conversion);
	db.exec('COMMIT');
	const converted = db.prepare('SELECT * FROM invoices ORDER BY rowid').all();
	expect(converted).toHaveLength(invoices.length);
	for (let index = 0; index < invoices.length; index++) {
		expect(converted[index]).toEqual({ ...invoices[index], id: expect.any(String) });
		expect(z.uuid().safeParse(converted[index].id).success).toBe(true);
	}
	expect(converted[3].id).toBe(invoices[3].id);
	expect(db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(entries);
	const saved = db.prepare('SELECT * FROM robokassa_invoice_details ORDER BY inv_id').all();
	for (let index = 0; index < details.length; index++) {
		expect(saved[index]).toEqual({
			...details[index],
			inv_id: index + 1,
			invoice_id: converted[index].id
		});
	}
	expect(
		db
			.prepare(
				"SELECT name FROM sqlite_master WHERE name LIKE '_invoice_%' OR name = '_robokassa_invoice_details'"
			)
			.all()
	).toEqual([]);
	expect(() => db.exec("UPDATE invoices SET amount_minor = 2 WHERE status = 'paid'")).toThrow(
		'immutable'
	);
	expect(() => db.exec('UPDATE robokassa_invoice_details SET inv_id = 99')).toThrow('immutable');
	expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('creates the processor schema and preserves accounting triggers and welcome bonuses', () => {
	db.close();
	db = previousDatabase();
	db.exec(
		"INSERT INTO ledger_entries (user_id, amount, entry_side, reason) VALUES ('u', 30, 'credit', 'welcome-bonus')"
	);
	const entries = db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
	const accountingTriggers = db
		.prepare(
			"SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'invoices' ORDER BY name"
		)
		.all();
	expect(db.prepare('SELECT * FROM invoices').all()).toEqual([]);
	db.exec(readFileSync(new URL('0028_robokassa_invoice_details.sql', migrations), 'utf8'));
	expect(db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(entries);
	expect(() =>
		db.exec(
			"INSERT INTO ledger_entries (user_id, amount, entry_side, reason) VALUES ('u', 30, 'credit', 'welcome-bonus')"
		)
	).toThrow('UNIQUE');
	expect(db.prepare('SELECT * FROM invoices').all()).toEqual([]);
	expect(db.prepare('SELECT * FROM robokassa_invoice_details').all()).toEqual([]);
	expect(
		db
			.prepare(
				"SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'invoices' AND name <> 'invoices_prevent_quoted_terms_update' ORDER BY name"
			)
			.all()
	).toEqual(accountingTriggers);
	expect(
		db.prepare("SELECT name FROM sqlite_master WHERE name = '_invoice_uuid_ids'").all()
	).toEqual([]);
});

it('rolls back conversion when a stored provider ID is invalid', () => {
	originalDatabase();
	db.exec(
		"INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at) VALUES ('invalid', 'robokassa', 'u', 1, 'USD', 1)"
	);
	db.exec(
		"INSERT INTO robokassa_invoice_details (invoice_id, payment_url, rub_amount_minor, rub_per_usd, rate_as_of, is_test, hash_algorithm) VALUES ('invalid', 'https://example.test', 83, '82.5', 1, 1, 'md5')"
	);
	const before = db.prepare('SELECT * FROM invoices').all();
	db.exec('BEGIN');
	try {
		expect(() => db.exec(conversion)).toThrow('CHECK');
	} finally {
		db.exec('ROLLBACK');
	}
	expect(db.prepare('SELECT * FROM invoices').all()).toEqual(before);
	expect(
		db
			.prepare(
				"SELECT name FROM pragma_table_info('robokassa_invoice_details') WHERE name = 'inv_id'"
			)
			.all()
	).toEqual([]);
});
