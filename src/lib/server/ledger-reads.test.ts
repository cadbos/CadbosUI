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

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { assertGenerationAllowed, getCredit } from './billing';
import {
	getGenerationDetailForUser,
	getUsageTotals,
	listCreditHistory,
	listUserUsage
} from './generations';
import { makeDb, type TestDatabase } from './testing/d1-shim';
import { seedCredit } from './testing/ledger-fixtures';
import { seedGeneration } from './testing/generation-fixtures';

let db: TestDatabase;

beforeEach(async () => {
	db = makeDb();
	await db.run(
		sql`INSERT INTO users (id, pubkey, created_at) VALUES ('user-1', 'pubkey-1', 1), ('user-2', 'pubkey-2', 2)`
	);
});

async function entry(
	userId: string,
	amount: number,
	side: 'debit' | 'credit',
	createdAt: number,
	reason: string | null = 'top-up'
): Promise<void> {
	await db.run(
		sql`INSERT INTO ledger_entries (user_id, amount, entry_side, reason, created_at) VALUES (${userId}, ${amount}, ${side}, ${reason}, ${createdAt})`
	);
}

async function generation(
	id: string,
	createdAt: number,
	amount: number,
	balanceAfter: number
): Promise<void> {
	await seedGeneration(db, {
		id,
		userId: 'user-1',
		url: `https://uploads.cadbos.example/${id}.webp`,
		sourceUrl: 'https://uploads.cadbos.example/source.webp',
		createdAt,
		amount,
		balanceAfter
	});
}

describe('ledger readers', () => {
	it('keeps free generations in history and usage without changing balances or spending', async () => {
		await seedCredit(db, 'user-1', 12);
		await generation('paid', 10, 2, 10);
		await generation('free', 10, 0, 10);
		await entry('user-1', 0, 'credit', 20);
		await entry('user-1', 0, 'debit', 21);
		expect(await getCredit(db, 'user-1')).toEqual({ balance: 10, updatedAt: 21, enabled: true });
		expect(await listCreditHistory(db, 'user-1')).toEqual([
			expect.objectContaining({
				id: expect.any(String),
				generationId: 'free',
				amount: 0,
				balanceAfter: 10
			}),
			expect.objectContaining({
				id: expect.any(String),
				generationId: 'paid',
				amount: 2,
				balanceAfter: 10
			})
		]);
		expect(await getGenerationDetailForUser(db, 'user-1', 'free')).toMatchObject({
			amount: 0,
			balanceAfter: 10
		});
		const { users } = await listUserUsage(db, 0, 10);
		expect(users.find((user) => user.pubkey === 'pubkey-1')).toMatchObject({
			balance: 10,
			generationCount: 2,
			totalSpend: 2,
			totalDeposit: 12
		});
		expect(await getUsageTotals(db)).toMatchObject({
			generationCount: 2,
			totalSpend: 2,
			totalDeposit: 12
		});
		const [freeCharge] = await listCreditHistory(db, 'user-1', 1);
		await db.run(sql`DELETE FROM generations WHERE id = 'free'`);
		expect(await listCreditHistory(db, 'user-1', 1)).toEqual([
			expect.objectContaining({
				id: freeCharge.id,
				generationId: null,
				kind: null,
				amount: 0,
				balanceAfter: 10
			})
		]);
	});

	it('distinguishes unapproved, empty, disabled and funded accounts', async () => {
		await entry('user-2', 500, 'credit', 1);
		expect(await getCredit(db, 'user-2')).toBeNull();
		expect(await assertGenerationAllowed(db, 'user-2')).toEqual({
			allowed: false,
			reason: 'not_approved'
		});
		await seedCredit(db, 'user-1', 0);
		expect(await getCredit(db, 'user-1')).toEqual({ balance: 0, updatedAt: 0, enabled: true });
		expect(await assertGenerationAllowed(db, 'user-1')).toEqual({
			allowed: false,
			reason: 'insufficient_credit'
		});
		await entry('user-1', 1234, 'credit', 20);
		expect(await getCredit(db, 'user-1')).toEqual({ balance: 12.34, updatedAt: 20, enabled: true });
		expect(await assertGenerationAllowed(db, 'user-1')).toEqual({ allowed: true, balance: 12.34 });
		await db.run(sql`UPDATE credits SET enabled = 0 WHERE user_id = 'user-1'`);
		expect(await getCredit(db, 'user-1')).toEqual({
			balance: 12.34,
			updatedAt: 20,
			enabled: false
		});
		expect(await assertGenerationAllowed(db, 'user-1')).toEqual({
			allowed: false,
			reason: 'not_approved'
		});
	});

	it('uses signed entries including adjustments and preserves negative balances', async () => {
		await seedCredit(db, 'user-1', 1);
		await entry('user-1', 150, 'debit', 10, 'historical-reconciliation');
		expect(await getCredit(db, 'user-1')).toEqual({ balance: -0.5, updatedAt: 10, enabled: true });
		expect(await assertGenerationAllowed(db, 'user-1')).toEqual({
			allowed: false,
			reason: 'insufficient_credit'
		});
		await entry('user-1', 200, 'credit', 5);
		expect(await getCredit(db, 'user-1')).toEqual({ balance: 1.5, updatedAt: 5, enabled: true });
	});

	it('keeps balances at each debit stable and uses ledger IDs for timestamp ties', async () => {
		await seedCredit(db, 'user-1', 12);
		await generation('first', 10, 0.03, 11.97);
		await entry('user-1', 3, 'credit', 10);
		await generation('second', 10, 0.29, 11.71);
		await entry('user-1', 500, 'credit', 1);
		const history = await listCreditHistory(db, 'user-1', 1);
		expect(history).toEqual([
			expect.objectContaining({
				id: expect.any(String),
				generationId: 'second',
				amount: 0.29,
				balanceAfter: 11.71
			})
		]);
		expect(await getGenerationDetailForUser(db, 'user-1', 'first')).toMatchObject({
			amount: 0.03,
			balanceAfter: 11.97
		});
		expect(await getGenerationDetailForUser(db, 'user-2', 'first')).toBeNull();
		expect(await listCreditHistory(db, 'user-2')).toEqual([]);
		expect((await getCredit(db, 'user-1'))?.balance).toBe(16.71);
	});

	it('retains charges after deletion without stale metadata or links', async () => {
		await seedCredit(db, 'user-1', 12);
		await generation('deleted', 10, 2, 10);
		const [charge] = await listCreditHistory(db, 'user-1');
		expect(charge).toMatchObject({ generationId: 'deleted' });
		await db.run(sql`DELETE FROM generations WHERE id = 'deleted'`);
		expect(db.prepare('PRAGMA foreign_key_check').all().results).toEqual([]);
		expect(await listCreditHistory(db, 'user-1')).toEqual([
			expect.objectContaining({
				id: charge.id,
				generationId: null,
				kind: null,
				amount: 2,
				balanceAfter: 10,
				sessionId: null,
				projectId: null,
				comfyuiExecutionSec: 0,
				archaiRenderSec: 0
			})
		]);
		const { users } = await listUserUsage(db, 0, 10);
		expect(users.find((user) => user.pubkey === 'pubkey-1')).toMatchObject({
			balance: 10,
			generationCount: 0,
			totalSpend: 2,
			latestSpendAt: 10
		});
		expect(await getUsageTotals(db)).toMatchObject({
			generationCount: 0,
			totalSpend: 2,
			totalDeposit: 12
		});
	});

	it('counts funding credits while excluding inferred reconciliation credits', async () => {
		await seedCredit(db, 'user-1', 12, 1, 5);
		await entry('user-1', 250, 'credit', 10);
		await entry('user-1', 100, 'credit', 11, null);
		await entry('user-1', 700, 'credit', 30, 'historical-reconciliation');
		await entry('user-1', 200, 'debit', 31, 'historical-reconciliation');
		await entry('user-2', 350, 'credit', 12);
		const { users } = await listUserUsage(db, 0, 10);
		expect(users.find((user) => user.pubkey === 'pubkey-1')).toMatchObject({
			balance: 20.5,
			totalDeposit: 15.5,
			lastDepositAt: 11,
			totalSpend: 0,
			latestSpendAt: null
		});
		expect(users.find((user) => user.pubkey === 'pubkey-2')).toMatchObject({
			balance: 3.5,
			totalDeposit: 3.5,
			lastDepositAt: 12
		});
		expect(await getUsageTotals(db)).toMatchObject({ totalDeposit: 19, totalSpend: 0 });
		expect(await listCreditHistory(db, 'user-1')).toEqual([]);
	});
});
