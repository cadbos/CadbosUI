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

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = new URL('../../../../migrations/', import.meta.url);

function readMigration(name: string): string {
	return readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8');
}

describe('0007_ledgers migration', () => {
	it('backfills balances, access, generations, and immutable ledger records', () => {
		const db = new DatabaseSync(':memory:');
		db.exec('PRAGMA foreign_keys = ON');
		for (let index = 1; index <= 6; index += 1) {
			const name = `${String(index).padStart(4, '0')}_${['auth', 'balance', 'generated_images', 'credits', 'generation_access', 'generations'][index - 1]}.sql`;
			db.exec(readMigration(name));
		}

		db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)').run(
			'user-1',
			'pubkey-1',
			1000
		);
		db.prepare(
			'INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, ?)'
		).run('user-1', 4.94, 6000, 0);
		db.prepare('INSERT INTO balances (user_id, balance, updated_at) VALUES (?, ?, ?)').run(
			'user-1',
			48,
			6000
		);
		db.prepare(
			'INSERT INTO generations ' +
				'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run(
			'generation-1',
			'user-1',
			'https://cdn.example.test/output.webp',
			'https://cdn.example.test/input.jpg',
			'cozy',
			'render',
			0.06,
			4.94,
			5000
		);

		db.exec(readMigration('0007_ledgers.sql'));

		expect(
			db
				.prepare(
					'SELECT access.enabled, balance.balance FROM generation_access access ' +
						'JOIN ledger_accounts account ON account.user_id = access.user_id ' +
						'JOIN ledger_account_balances balance ON balance.account_id = account.id'
				)
				.get()
		).toEqual({ enabled: 0, balance: 494 });
		expect(
			db
				.prepare(
					'SELECT balance.balance FROM ledger_accounts account ' +
						'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
						"WHERE account.asset = 'archai_token'"
				)
				.get()
		).toEqual({ balance: 4800 });
		expect(
			db
				.prepare(
					"SELECT amount, typeof(amount) AS type FROM ledger_entries WHERE transaction_id = 'generation:generation-1' ORDER BY account_id"
				)
				.all()
		).toEqual([
			{ amount: -6, type: 'integer' },
			{ amount: -6, type: 'integer' }
		]);
		expect(
			db.prepare('SELECT COUNT(*) AS count FROM ledger_transactions WHERE finalized <> 1').get()
		).toEqual({ count: 0 });
		expect(
			db
				.prepare(
					"SELECT typeof(balance) AS type FROM ledger_account_balances WHERE account_id = 'app-credit:user-1'"
				)
				.get()
		).toEqual({ type: 'integer' });
		expect(
			db
				.prepare(
					'SELECT generation.prompt, generation.kind, detail.output_url, detail.input_url ' +
						'FROM generations generation JOIN image_generation_details detail ' +
						'ON detail.generation_id = generation.id'
				)
				.get()
		).toEqual({
			prompt: 'cozy',
			kind: 'render',
			output_url: 'https://cdn.example.test/output.webp',
			input_url: 'https://cdn.example.test/input.jpg'
		});
		expect(() => db.prepare('SELECT * FROM credits').all()).toThrow('no such table: credits');
		expect(() => db.prepare('UPDATE ledger_entries SET amount = 1').run()).toThrow(
			'ledger entries are immutable'
		);
		expect(() =>
			db
				.prepare(
					"DELETE FROM ledger_entries WHERE transaction_id = 'generation:generation-1' AND account_id = 'archai-token'"
				)
				.run()
		).toThrow('ledger entries are immutable');
		expect(() =>
			db.prepare('UPDATE ledger_transactions SET occurred_at = occurred_at + 1').run()
		).toThrow('ledger transactions are immutable');
		for (const update of [
			"UPDATE generations SET id = 'generation-renamed' WHERE id = 'generation-1'",
			"UPDATE generations SET user_id = 'missing-user' WHERE id = 'generation-1'",
			"UPDATE generations SET prompt = 'updated prompt' WHERE id = 'generation-1'",
			"UPDATE generations SET kind = 'variation' WHERE id = 'generation-1'",
			"UPDATE generations SET ledger_transaction_id = 'generation:other' WHERE id = 'generation-1'",
			"UPDATE generations SET created_at = created_at + 1 WHERE id = 'generation-1'"
		]) {
			expect(() => db.prepare(update).run()).toThrow(
				'generation ledger transactions are immutable'
			);
		}

		db.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)').run(
			'finalization-entry',
			7000
		);
		expect(() =>
			db
				.prepare('UPDATE ledger_transactions SET occurred_at = NULL, finalized = 1 WHERE id = ?')
				.run('finalization-entry')
		).toThrow('ledger transactions are immutable');
		db.prepare(
			'INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)'
		).run('finalization-entry', 'app-credit:user-1', 1);
		db.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?').run(
			'finalization-entry'
		);
		expect(() =>
			db
				.prepare('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)')
				.run('finalization-entry', 'archai-token', 1)
		).toThrow('ledger transaction is finalized');
		expect(() =>
			db
				.prepare('UPDATE ledger_transactions SET finalized = 0 WHERE id = ?')
				.run('finalization-entry')
		).toThrow('ledger transactions are immutable');

		db.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)').run(
			'fractional-entry',
			8000
		);
		expect(() =>
			db
				.prepare('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)')
				.run('fractional-entry', 'app-credit:user-1', 0.5)
		).toThrow();

		db.prepare('DELETE FROM image_generation_details WHERE generation_id = ?').run('generation-1');
		expect(db.prepare('SELECT id FROM generations WHERE id = ?').get('generation-1')).toEqual({
			id: 'generation-1'
		});
	});

	it('keeps generation-only users out of app-credit accounts and access', () => {
		const db = new DatabaseSync(':memory:');
		db.exec('PRAGMA foreign_keys = ON');
		for (let index = 1; index <= 6; index += 1) {
			const name = `${String(index).padStart(4, '0')}_${['auth', 'balance', 'generated_images', 'credits', 'generation_access', 'generations'][index - 1]}.sql`;
			db.exec(readMigration(name));
		}

		db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)').run(
			'legacy-user',
			'legacy-pubkey',
			1000
		);
		db.prepare(
			'INSERT INTO generations ' +
				'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run(
			'legacy-generation',
			'legacy-user',
			'https://cdn.example.test/legacy-output.webp',
			'https://cdn.example.test/legacy-input.jpg',
			'legacy cozy',
			'render',
			2,
			0,
			5000
		);

		db.exec(readMigration('0007_ledgers.sql'));

		expect(
			db.prepare('SELECT user_id FROM generation_access WHERE user_id = ?').get('legacy-user')
		).toBeUndefined();
		expect(
			db
				.prepare("SELECT id FROM ledger_accounts WHERE user_id = ? AND asset = 'app_credit'")
				.get('legacy-user')
		).toBeUndefined();
		expect(
			db
				.prepare(
					"SELECT amount FROM ledger_entries WHERE transaction_id = ? AND account_id = 'archai-token'"
				)
				.get('generation:legacy-generation')
		).toEqual({ amount: -200 });
		expect(db.prepare('SELECT id FROM generations WHERE id = ?').get('legacy-generation')).toEqual({
			id: 'legacy-generation'
		});

		db.prepare(
			'INSERT INTO ledger_accounts (id, asset, user_id, created_at) VALUES (?, ?, ?, ?)'
		).run('app-credit:legacy-user', 'app_credit', 'legacy-user', 6000);
		db.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)').run(
			'opening:app-credit:legacy-user',
			6000
		);
		db.prepare(
			'INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)'
		).run('opening:app-credit:legacy-user', 'app-credit:legacy-user', 1200);
		db.prepare('INSERT INTO ledger_openings (account_id, transaction_id) VALUES (?, ?)').run(
			'app-credit:legacy-user',
			'opening:app-credit:legacy-user'
		);
		db.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?').run(
			'opening:app-credit:legacy-user'
		);
		db.prepare('INSERT INTO generation_access (user_id, enabled) VALUES (?, ?)').run(
			'legacy-user',
			1
		);

		expect(
			db
				.prepare(
					'SELECT access.enabled, balance.balance FROM generation_access access ' +
						'JOIN ledger_accounts account ON account.user_id = access.user_id ' +
						'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
						'WHERE access.user_id = ?'
				)
				.get('legacy-user')
		).toEqual({ enabled: 1, balance: 1200 });
	});

	it('enforces generation operation identities, states, transitions, and immutability', () => {
		const db = new DatabaseSync(':memory:');
		db.exec('PRAGMA foreign_keys = ON');
		for (let index = 1; index <= 7; index += 1) {
			const name = `${String(index).padStart(4, '0')}_${['auth', 'balance', 'generated_images', 'credits', 'generation_access', 'generations', 'ledgers'][index - 1]}.sql`;
			db.exec(readMigration(name));
		}
		db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)').run(
			'user-1',
			'pubkey-1',
			1000
		);

		expect(() =>
			db
				.prepare(
					'INSERT INTO generation_operations ' +
						'(id, user_id, input_url, prompt, kind, status, created_at) ' +
						"VALUES ('not-a-uuid', 'user-1', 'https://example.test/in.jpg', 'cozy', 'render', 'pending', 2000)"
				)
				.run()
		).toThrow();

		const operationId = '00000000-0000-4000-8000-000000000001';
		db.prepare(
			'INSERT INTO generation_operations ' +
				'(id, user_id, input_url, prompt, kind, status, created_at) ' +
				"VALUES (?, 'user-1', 'https://example.test/in.jpg', 'cozy', 'render', 'pending', 2000)"
		).run(operationId);

		expect(() =>
			db
				.prepare(
					"UPDATE generation_operations SET status = 'completed', cost_units = 100, " +
						"output_url = 'https://example.test/out.webp', confirmed_at = 3000, " +
						'balance_after_units = 400, completed_at = 3001 WHERE id = ?'
				)
				.run(operationId)
		).toThrow('invalid generation operation transition');

		db.prepare(
			"UPDATE generation_operations SET status = 'confirmed', cost_units = 100, " +
				"output_url = 'https://example.test/out.webp', confirmed_at = 3000 WHERE id = ?"
		).run(operationId);
		expect(() =>
			db
				.prepare(
					"UPDATE generation_operations SET status = 'failed', cost_units = NULL, " +
						'output_url = NULL, confirmed_at = NULL, failed_at = 3001 WHERE id = ?'
				)
				.run(operationId)
		).toThrow('invalid generation operation transition');

		db.prepare(
			"UPDATE generation_operations SET status = 'completed', balance_after_units = 400, " +
				'completed_at = 4000 WHERE id = ?'
		).run(operationId);
		expect(() =>
			db
				.prepare("UPDATE generation_operations SET prompt = 'changed' WHERE id = ?")
				.run(operationId)
		).toThrow('invalid generation operation transition');
		expect(() =>
			db.prepare('DELETE FROM generation_operations WHERE id = ?').run(operationId)
		).toThrow('generation operations are immutable');
	});
});
