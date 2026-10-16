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

const migrations = new URL('../../../migrations/', import.meta.url);
let db: DatabaseSync;
beforeEach(() => {
	db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const name of readdirSync(migrations)
		.filter((name) => name.endsWith('.sql'))
		.sort()) {
		if (name.startsWith('0026')) break;
		db.exec(readFileSync(new URL(name, migrations), 'utf8'));
	}
	db.exec(`INSERT INTO users (id, pubkey, created_at) VALUES ('u', 'p', 1);
 INSERT INTO credits (user_id, enabled) VALUES ('u', 0);
 INSERT INTO ledger_entries (user_id, amount, entry_side, reason) VALUES ('u', 123, 'credit', 'top-up');
 INSERT INTO invoices (id, payment_processor, user_id, amount_minor, currency, created_at, updated_at)
 VALUES ('1', 'robokassa', 'u', 1, 'USD', 1, 1);`);
	db.exec(readFileSync(new URL('0026_robokassa_invoice_details.sql', migrations), 'utf8'));
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
		invoice_id: '1',
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
		"UPDATE invoices SET status = 'cancelled'; UPDATE invoices SET status = 'paid', paid_at = 2, updated_at = 2, ledger_entry_id = (SELECT id FROM ledger_entries WHERE amount = 1)"
	);
	expect(db.prepare('SELECT status, ledger_entry_id FROM invoices').get()).toEqual({
		status: 'paid',
		ledger_entry_id: 2
	});
});
