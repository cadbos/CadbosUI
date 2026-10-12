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
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../../../migrations/', import.meta.url);
const INVOICE_MIGRATION = '0025_invoices.sql';
const migrationFiles = readdirSync(MIGRATIONS)
	.filter((name) => name.endsWith('.sql'))
	.sort();

function migration(name: string): string {
	return readFileSync(new URL(name, MIGRATIONS), 'utf8');
}

function previousDatabase(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const name of migrationFiles) {
		if (name === INVOICE_MIGRATION) break;
		db.exec(migration(name));
	}
	return db;
}

function writeInvoice(
	db: DatabaseSync,
	operation: 'insert' | 'update',
	values: Record<string, SQLInputValue> = {}
): void {
	db.prepare(
		operation === 'insert'
			? `INSERT INTO invoices (id, payment_processor, user_id, ledger_entry_id, amount_minor,
				currency, status, created_at, updated_at, paid_at)
				VALUES (:id, :payment_processor, :user_id, :ledger_entry_id, :amount_minor,
				:currency, :status, :created_at, :updated_at, :paid_at)`
			: `UPDATE invoices SET payment_processor = :payment_processor, user_id = :user_id,
				ledger_entry_id = :ledger_entry_id, amount_minor = :amount_minor, currency = :currency,
				status = :status, created_at = :created_at, updated_at = :updated_at, paid_at = :paid_at
				WHERE id = :id`
	).run({
		id: 'invoice-1',
		payment_processor: 'test-processor',
		user_id: 'user-1',
		ledger_entry_id: null,
		amount_minor: 500,
		currency: 'USD',
		status: 'open',
		created_at: 100,
		updated_at: 100,
		paid_at: null,
		...values
	});
}

describe('0025 invoice migration', () => {
	it('applies the complete migration sequence to a fresh database', () => {
		const db = new DatabaseSync(':memory:');
		try {
			db.exec('PRAGMA foreign_keys = ON');
			for (const name of migrationFiles) db.exec(migration(name));
			expect(db.prepare('SELECT * FROM invoices').all()).toEqual([]);
			expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('preserves existing ledger entries, balances and access flags', () => {
		const db = previousDatabase();
		try {
			db.exec(`INSERT INTO users (id, pubkey, created_at)
				VALUES ('user-1', 'pubkey-1', 1), ('user-2', 'pubkey-2', 1);
				INSERT INTO credits (user_id, enabled) VALUES ('user-1', 1), ('user-2', 0);
				INSERT INTO ledger_entries (user_id, amount, entry_side, reason)
				VALUES ('user-1', 1200, 'credit', 'top-up'),
					('user-1', 100, 'debit', 'generation-charge'),
					('user-2', 50, 'debit', 'adjustment');`);
			const entries = db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
			const access = db.prepare('SELECT * FROM credits ORDER BY user_id').all();
			const balanceQuery = `SELECT user_id,
				SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END) AS balance
				FROM ledger_entries GROUP BY user_id ORDER BY user_id`;
			const balances = db.prepare(balanceQuery).all();

			db.exec(migration(INVOICE_MIGRATION));

			expect(db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(entries);
			expect(db.prepare('SELECT * FROM credits ORDER BY user_id').all()).toEqual(access);
			expect(db.prepare(balanceQuery).all()).toEqual(balances);
			expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
		} finally {
			db.close();
		}
	});

	describe('invoice constraints', () => {
		let db: DatabaseSync;

		beforeEach(() => {
			db = previousDatabase();
			db.exec(migration(INVOICE_MIGRATION));
			db.exec(`INSERT INTO users (id, pubkey, created_at)
				VALUES ('user-1', 'pubkey-1', 1), ('user-2', 'pubkey-2', 1);
				INSERT INTO ledger_entries (id, user_id, amount, entry_side, reason)
				VALUES (1, 'user-1', 500, 'credit', 'top-up'),
					(2, 'user-2', 500, 'credit', 'top-up'),
					(3, 'user-1', 500, 'debit', 'top-up'),
					(4, 'user-1', 500, 'credit', 'adjustment'),
					(5, 'user-1', 500, 'credit', NULL),
					(6, 'user-1', 501, 'credit', 'top-up'),
					(7, 'user-1', 500, 'credit', 'top-up');`);
		});

		afterEach(() => {
			try {
				expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
			} finally {
				db.close();
			}
		});

		describe.each(['insert', 'update'] as const)('%s validation', (operation) => {
			beforeEach(() => {
				if (operation === 'update') writeInvoice(db, 'insert');
			});

			it.each(['open', 'cancelled'])('accepts %s invoices without payment fields', (status) => {
				writeInvoice(db, operation, { status });
				expect(db.prepare('SELECT status, paid_at, ledger_entry_id FROM invoices').get()).toEqual({
					status,
					paid_at: null,
					ledger_entry_id: null
				});
			});

			it('accepts paid invoices with a matching top-up credit', () => {
				writeInvoice(db, operation, { status: 'paid', paid_at: 100, ledger_entry_id: 1 });
				expect(db.prepare('SELECT status, paid_at, ledger_entry_id FROM invoices').get()).toEqual({
					status: 'paid',
					paid_at: 100,
					ledger_entry_id: 1
				});
			});

			it.each([1, Number.MAX_SAFE_INTEGER])('accepts the valid amount boundary %s', (amount) => {
				writeInvoice(db, operation, { amount_minor: amount });
				expect(db.prepare('SELECT amount_minor FROM invoices').get()).toEqual({
					amount_minor: amount
				});
			});

			it.each<Record<string, SQLInputValue>>([
				{ user_id: null },
				{ user_id: 'missing-user' },
				{ payment_processor: null },
				{ payment_processor: '' },
				{ payment_processor: '   ' },
				{ amount_minor: null },
				{ amount_minor: 0 },
				{ amount_minor: -1 },
				{ amount_minor: 1.5 },
				{ amount_minor: 'invalid' },
				{ amount_minor: Number.MAX_SAFE_INTEGER + 1 },
				{ amount_minor: Infinity },
				{ currency: null },
				{ currency: 'EUR' },
				{ currency: 'RUB' },
				{ currency: 'usd' },
				{ currency: '' },
				{ status: null },
				{ status: 'unknown' },
				{ created_at: 0.5 },
				{ updated_at: 99 },
				{ updated_at: 100.5 }
			])('rejects invalid invoice values %j', (values) => {
				expect(() => writeInvoice(db, operation, values)).toThrow();
			});

			it.each([
				{ name: 'missing entry', ledgerEntryId: 999 },
				{ name: 'wrong owner', ledgerEntryId: 2 },
				{ name: 'debit', ledgerEntryId: 3 },
				{ name: 'wrong reason', ledgerEntryId: 4 },
				{ name: 'missing reason', ledgerEntryId: 5 },
				{ name: 'mismatched amount', ledgerEntryId: 6 }
			])('rejects a link to a $name', ({ ledgerEntryId }) => {
				expect(() =>
					writeInvoice(db, operation, {
						status: 'paid',
						paid_at: 100,
						ledger_entry_id: ledgerEntryId
					})
				).toThrow('invoice credit does not match');
			});

			it.each<Record<string, SQLInputValue>>([{ user_id: 'user-2' }, { amount_minor: 501 }])(
				'rejects settlement with invoice fields that disagree with the credit: %j',
				(values) => {
					expect(() =>
						writeInvoice(db, operation, {
							status: 'paid',
							paid_at: 100,
							ledger_entry_id: 1,
							...values
						})
					).toThrow('invoice credit does not match');
				}
			);

			it.each([
				['open', 100, null],
				['open', null, 1],
				['open', 100, 1],
				['cancelled', 100, null],
				['cancelled', null, 1],
				['cancelled', 100, 1],
				['paid', null, null],
				['paid', 100, null],
				['paid', null, 1],
				['paid', 100.5, 1],
				['paid', 'invalid', 1]
			] as const)(
				'rejects inconsistent payment fields: status=%s, paid_at=%s, ledger_entry_id=%s',
				(status, paidAt, ledgerEntryId) => {
					expect(() =>
						writeInvoice(db, operation, { status, paid_at: paidAt, ledger_entry_id: ledgerEntryId })
					).toThrow('CHECK');
				}
			);

			it('rejects a credit already linked to another invoice', () => {
				writeInvoice(db, 'insert', {
					id: 'other-invoice',
					status: 'paid',
					paid_at: 100,
					ledger_entry_id: 1
				});
				expect(() =>
					writeInvoice(db, operation, { status: 'paid', paid_at: 100, ledger_entry_id: 1 })
				).toThrow('UNIQUE');
			});
		});

		it.each([
			"id = 'other-id'",
			"payment_processor = 'other-processor'",
			"user_id = 'user-2'",
			'amount_minor = 501',
			"currency = 'EUR'",
			'paid_at = 101',
			'ledger_entry_id = 7',
			"status = 'open', paid_at = NULL, ledger_entry_id = NULL",
			"status = 'cancelled', paid_at = NULL, ledger_entry_id = NULL",
			"user_id = 'user-2', ledger_entry_id = 2",
			'amount_minor = 501, ledger_entry_id = 6'
		])('prevents changing settled accounting fields: %s', (assignments) => {
			writeInvoice(db, 'insert', { status: 'paid', paid_at: 100, ledger_entry_id: 1 });
			const invoice = db.prepare('SELECT * FROM invoices').get();
			expect(() => db.exec(`UPDATE invoices SET ${assignments}`)).toThrow();
			expect(db.prepare('SELECT * FROM invoices').get()).toEqual(invoice);
		});

		it('allows updating paid invoice metadata without changing settled accounting fields', () => {
			writeInvoice(db, 'insert', { status: 'paid', paid_at: 100, ledger_entry_id: 1 });
			db.exec('UPDATE invoices SET updated_at = 101, amount_minor = amount_minor');
			expect(db.prepare('SELECT updated_at, amount_minor FROM invoices').get()).toEqual({
				updated_at: 101,
				amount_minor: 500
			});
		});

		it('keeps credits immutable and independent when an invoice is deleted', () => {
			writeInvoice(db, 'insert', { status: 'paid', paid_at: 100, ledger_entry_id: 1 });
			const entry = db.prepare('SELECT * FROM ledger_entries WHERE id = 1').get();
			expect(() => db.exec('UPDATE ledger_entries SET amount = 501 WHERE id = 1')).toThrow(
				'immutable'
			);
			expect(() => db.exec('DELETE FROM ledger_entries WHERE id = 1')).toThrow('immutable');
			db.exec('DELETE FROM invoices');
			expect(db.prepare('SELECT * FROM invoices').all()).toEqual([]);
			expect(db.prepare('SELECT * FROM ledger_entries WHERE id = 1').get()).toEqual(entry);
			expect(() => db.exec('DELETE FROM ledger_entries WHERE id = 1')).toThrow('immutable');
		});
	});
});
