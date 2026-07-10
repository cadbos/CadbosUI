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
import { grantGenerationAccess, makeD1 } from './testing/d1-shim';
import {
	getCredit,
	getUserIdByPubkey,
	hasGenerationAccess,
	hasSufficientCredit,
	type CreditAccess
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

describe('getCredit', () => {
	it('is null when no admin has approved this account', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		await expect(getCredit(db, 'user-1')).resolves.toBeNull();
	});

	it('returns the admin-chosen balance and enabled flag for an approved account', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 12, 1);

		const credit = await getCredit(db, 'user-1');
		expect(credit).toEqual(expect.objectContaining({ balance: 12, enabled: true }));
	});

	it('reflects an account the admin disabled', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 12, 0);

		const credit = await getCredit(db, 'user-1');
		expect(credit?.enabled).toBe(false);
	});
});

describe('hasGenerationAccess', () => {
	it('is false when there is no row at all', () => {
		expect(hasGenerationAccess(null)).toBe(false);
	});

	it('is false when the row exists but is disabled', () => {
		expect(hasGenerationAccess({ balance: 5, updatedAt: 0, enabled: false })).toBe(false);
	});

	it('is true once enabled, regardless of remaining balance', () => {
		expect(hasGenerationAccess({ balance: 0, updatedAt: 0, enabled: true })).toBe(true);
	});
});

describe('hasSufficientCredit', () => {
	const enabled = (balance: number): CreditAccess => ({ balance, updatedAt: 0, enabled: true });

	it('is true while balance is positive', () => {
		expect(hasSufficientCredit(enabled(0.01))).toBe(true);
	});

	it('is false once balance hits zero or goes negative', () => {
		expect(hasSufficientCredit(enabled(0))).toBe(false);
		expect(hasSufficientCredit(enabled(-1))).toBe(false);
	});
});
