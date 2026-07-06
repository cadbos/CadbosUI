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

import { beforeEach, describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { makeD1 } from './testing/d1-shim';
import {
	deductCredit,
	getBalance,
	getOrCreateCredit,
	getUserIdByPubkey,
	hasSufficientCredit,
	isMeteredPubkey,
	listCreditHistory,
	recordBalance
} from './billing';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

let db: D1Database;

beforeEach(() => {
	db = makeD1();
});

describe('getUserIdByPubkey', () => {
	it('resolves the internal user id for a known pubkey', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await expect(getUserIdByPubkey(db, 'pubkey-1')).resolves.toBe('user-1');
	});

	it('returns null for an unknown pubkey', async () => {
		await expect(getUserIdByPubkey(db, 'no-such-pubkey')).resolves.toBeNull();
	});
});

describe('getBalance', () => {
	it('is null before the user has ever generated', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await expect(getBalance(db, 'user-1')).resolves.toBeNull();
	});

	it('returns the last recorded balance', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await recordBalance(db, 'user-1', 24.97);

		const balance = await getBalance(db, 'user-1');
		expect(balance?.balance).toBe(24.97);
	});
});

describe('recordBalance', () => {
	it('creates a row on first generation', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const balance = await recordBalance(db, 'user-1', 25);
		expect(balance.balance).toBe(25);
	});

	it('overwrites the previous balance rather than accumulating it', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await recordBalance(db, 'user-1', 25);
		const second = await recordBalance(db, 'user-1', 24.97);

		expect(second.balance).toBe(24.97);
		await expect(getBalance(db, 'user-1')).resolves.toEqual(second);
	});

	it('isolates balances per user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		await recordBalance(db, 'user-1', 25);
		await recordBalance(db, 'user-2', 10);

		expect((await getBalance(db, 'user-1'))?.balance).toBe(25);
		expect((await getBalance(db, 'user-2'))?.balance).toBe(10);
	});
});

describe('isMeteredPubkey', () => {
	it('is false when the env var is unset', () => {
		expect(isMeteredPubkey(undefined, 'pubkey-1')).toBe(false);
	});

	it('is false for a pubkey not in the list', () => {
		expect(isMeteredPubkey('pubkey-1,pubkey-2', 'pubkey-3')).toBe(false);
	});

	it('is true for a pubkey in the comma-separated list, trimmed and case-insensitive', () => {
		expect(isMeteredPubkey('pubkey-1, PubKey-2 ', 'pubkey-2')).toBe(true);
	});
});

describe('getOrCreateCredit', () => {
	it('provisions the starting balance on first check', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const credit = await getOrCreateCredit(db, 'user-1');
		expect(credit.balance).toBe(5);
	});

	it('returns the same row on a later check rather than re-provisioning', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await getOrCreateCredit(db, 'user-1');
		await deductCredit(db, 'user-1', 2, 'render');

		const credit = await getOrCreateCredit(db, 'user-1');
		expect(credit.balance).toBe(3);
	});
});

describe('hasSufficientCredit', () => {
	it('is true while balance is positive', () => {
		expect(hasSufficientCredit({ balance: 0.01, updatedAt: 0 })).toBe(true);
	});

	it('is false once balance hits zero or goes negative', () => {
		expect(hasSufficientCredit({ balance: 0, updatedAt: 0 })).toBe(false);
		expect(hasSufficientCredit({ balance: -1, updatedAt: 0 })).toBe(false);
	});
});

describe('deductCredit', () => {
	it('subtracts the real cost and logs a transaction', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await getOrCreateCredit(db, 'user-1');

		const result = await deductCredit(db, 'user-1', 1.5, 'render');
		expect(result.balance).toBe(3.5);

		const history = await listCreditHistory(db, 'user-1');
		expect(history).toEqual([
			expect.objectContaining({ amount: 1.5, balanceAfter: 3.5, kind: 'render' })
		]);
	});

	it('isolates credit balances per user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		await getOrCreateCredit(db, 'user-1');
		await getOrCreateCredit(db, 'user-2');

		await deductCredit(db, 'user-1', 2, 'render');

		expect((await getOrCreateCredit(db, 'user-1')).balance).toBe(3);
		expect((await getOrCreateCredit(db, 'user-2')).balance).toBe(5);
	});
});

describe('listCreditHistory', () => {
	it('is empty before any deduction', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await getOrCreateCredit(db, 'user-1');
		await expect(listCreditHistory(db, 'user-1')).resolves.toEqual([]);
	});

	it('orders entries most-recent first', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await getOrCreateCredit(db, 'user-1');
		await deductCredit(db, 'user-1', 1, 'render');
		await deductCredit(db, 'user-1', 2, 'edit');

		const history = await listCreditHistory(db, 'user-1');
		expect(history.map((entry) => entry.kind)).toEqual(['edit', 'render']);
	});
});
