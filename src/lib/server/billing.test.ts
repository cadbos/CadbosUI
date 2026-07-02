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
import { deductQuota, getOrCreateQuota, getUserIdByPubkey, hasQuota } from './billing';

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

describe('getOrCreateQuota', () => {
	it('provisions a default quota on first touch', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		const quota = await getOrCreateQuota(db, 'user-1');
		expect(quota).toEqual({ balanceOrLimit: 50, usage: 0, period: 'lifetime' });
	});

	it('is idempotent — a second call does not reset usage', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await getOrCreateQuota(db, 'user-1');
		await deductQuota(db, 'user-1', 5);

		const quota = await getOrCreateQuota(db, 'user-1');
		expect(quota).toEqual({ balanceOrLimit: 50, usage: 5, period: 'lifetime' });
	});

	it('isolates quotas per user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		await getOrCreateQuota(db, 'user-1');
		await deductQuota(db, 'user-1', 10);

		const quota1 = await getOrCreateQuota(db, 'user-1');
		const quota2 = await getOrCreateQuota(db, 'user-2');
		expect(quota1.usage).toBe(10);
		expect(quota2.usage).toBe(0);
	});
});

describe('hasQuota', () => {
	it('is true while usage is below the limit', () => {
		expect(hasQuota({ balanceOrLimit: 50, usage: 49, period: 'lifetime' })).toBe(true);
	});

	it('is false once usage reaches or exceeds the limit', () => {
		expect(hasQuota({ balanceOrLimit: 50, usage: 50, period: 'lifetime' })).toBe(false);
		expect(hasQuota({ balanceOrLimit: 50, usage: 51, period: 'lifetime' })).toBe(false);
	});
});

describe('deductQuota', () => {
	it('increments usage by the given cost exactly once', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await getOrCreateQuota(db, 'user-1');

		const first = await deductQuota(db, 'user-1', 2);
		expect(first.usage).toBe(2);

		const second = await deductQuota(db, 'user-1', 3);
		expect(second.usage).toBe(5);
	});

	it('throws if the user has no quota row yet', async () => {
		await expect(deductQuota(db, 'no-such-user', 1)).rejects.toThrow();
	});
});
