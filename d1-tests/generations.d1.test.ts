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

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
	confirmGenerationOperation,
	createGenerationOperation,
	finalizeGenerationOperation
} from '$lib/server/generations';

async function seedApprovedUser(): Promise<void> {
	await env.DB.batch([
		env.DB.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)').bind(
			'user-1',
			'pubkey-1',
			1000
		),
		env.DB.prepare(
			'INSERT INTO ledger_accounts (id, asset, user_id, created_at) VALUES (?, ?, ?, ?)'
		).bind('app-credit:user-1', 'app_credit', 'user-1', 1000),
		env.DB.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)').bind(
			'opening:app-credit:user-1',
			1000
		),
		env.DB.prepare(
			'INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)'
		).bind('opening:app-credit:user-1', 'app-credit:user-1', 200),
		env.DB.prepare('INSERT INTO ledger_openings (account_id, transaction_id) VALUES (?, ?)').bind(
			'app-credit:user-1',
			'opening:app-credit:user-1'
		),
		env.DB.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?').bind(
			'opening:app-credit:user-1'
		),
		env.DB.prepare('INSERT INTO generation_access (user_id, enabled) VALUES (?, 1)').bind('user-1')
	]);
}

async function createConfirmedOperation(outputUrl: string): Promise<string> {
	const operationId = await createGenerationOperation(env.DB, 'user-1', {
		sourceUrl: 'https://cdn.example.test/room.jpg',
		prompt: 'cozy',
		kind: 'render'
	});
	await confirmGenerationOperation(env.DB, 'user-1', operationId, {
		outputUrl,
		cost: 1.5
	});
	return operationId;
}

describe('generation finalization on the Workers D1 runtime', () => {
	it('serializes competing debit batches and rolls back the overdraft', async () => {
		await seedApprovedUser();
		const firstId = await createConfirmedOperation('https://cdn.example.test/first.webp');
		const secondId = await createConfirmedOperation('https://cdn.example.test/second.webp');

		const attempts = await Promise.allSettled([
			finalizeGenerationOperation(env.DB, 'user-1', firstId),
			finalizeGenerationOperation(env.DB, 'user-1', secondId)
		]);

		expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
		expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
		await expect(
			env.DB.prepare(
				'SELECT balance.balance FROM ledger_accounts account ' +
					'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
					"WHERE account.asset = 'app_credit' AND account.user_id = 'user-1'"
			).first<{ balance: number }>()
		).resolves.toEqual({ balance: 50 });
		await expect(
			env.DB.prepare(
				'SELECT balance.balance FROM ledger_accounts account ' +
					'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
					"WHERE account.asset = 'archai_token' AND account.user_id IS NULL"
			).first<{ balance: number }>()
		).resolves.toEqual({ balance: -150 });
		await expect(
			env.DB.prepare('SELECT COUNT(*) AS count FROM generations').first<{ count: number }>()
		).resolves.toEqual({ count: 1 });
	});
});
