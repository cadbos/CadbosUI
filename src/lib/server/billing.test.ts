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
import { getBalance, getUserIdByPubkey, recordBalance } from './billing';

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
