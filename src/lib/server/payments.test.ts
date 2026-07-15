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

import type { D1Database } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import { toLedgerAmountUnits } from './ledger-units';
import { grantGenerationAccess, makeD1 } from './testing/d1-shim';

const lightning = vi.hoisted(() => ({
	createInvoice: vi.fn()
}));
vi.mock('$lib/server/lightning', () => lightning);

const { createDeposit, expireStaleDeposits, getDeposit, listPackages, markDepositPaid } =
	await import('./payments');

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function seedPackage(
	db: D1Database,
	id: string,
	usdAmount: number,
	creditsAwarded: number,
	archaiTokensAwarded: number,
	enabled = 1
): void {
	db.prepare(
		'INSERT INTO packages (id, usd_amount, credits_awarded, archai_tokens_awarded, enabled, created_at) ' +
			'VALUES (?, ?, ?, ?, ?, ?)'
	)
		.bind(id, usdAmount, creditsAwarded, archaiTokensAwarded, enabled, Date.now())
		.run();
}

function seedRate(db: D1Database, satsPerUsd: number, now: number): void {
	db.prepare(
		'INSERT INTO exchange_rate_cache (provider, sats_per_usd, fetched_at, expires_at) VALUES (?, ?, ?, ?)'
	)
		.bind('kraken', satsPerUsd, now, now + 90_000)
		.run();
}

async function readLedgerBalance(
	db: D1Database,
	asset: 'app_credit' | 'archai_token',
	userId: string | null
): Promise<number | null> {
	const row = await db
		.prepare(
			'SELECT balance.balance FROM ledger_accounts account ' +
				'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
				'WHERE account.asset = ? AND account.user_id IS ?'
		)
		.bind(asset, userId)
		.first<{ balance: number }>();
	return row?.balance ?? null;
}

const fakeNwc = {} as never;

describe('listPackages', () => {
	it('returns only enabled packages, ordered by usd amount', async () => {
		const db = makeD1();
		seedPackage(db, 'pkg-5', 5, 15, 15);
		seedPackage(db, 'pkg-1', 1, 3, 3);
		seedPackage(db, 'pkg-disabled', 3, 9, 9, 0);

		const packages = await listPackages(db);

		expect(packages).toEqual([
			{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3, archaiTokensAwarded: 3 },
			{ id: 'pkg-5', usdAmount: 5, creditsAwarded: 15, archaiTokensAwarded: 15 }
		]);
	});
});

describe('createDeposit', () => {
	it('locks the current rate and stores the invoice from the NWC client', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedPackage(db, 'pkg-1', 1, 3, 3);
		seedRate(db, 2000, 1000);
		lightning.createInvoice.mockResolvedValueOnce({
			invoice: 'lnbc1...',
			paymentHash: 'hash-1',
			satsAmount: 2000,
			createdAt: 1,
			expiresAt: 601
		});

		const deposit = await createDeposit(db, 'user-1', fakeNwc, { packageId: 'pkg-1' }, {}, 1000);

		expect(deposit).toMatchObject({
			userId: 'user-1',
			packageId: 'pkg-1',
			provider: 'nwc',
			bolt11: 'lnbc1...',
			paymentHash: 'hash-1',
			satsAmount: 2000,
			usdAmount: 1,
			satsPerUsdRate: 2000,
			creditsAwarded: 3,
			archaiTokensAwarded: 3,
			status: 'pending',
			paidAt: null
		});
		expect(lightning.createInvoice).toHaveBeenCalledWith(
			fakeNwc,
			2000,
			expect.stringContaining('pkg-1'),
			expect.any(Number),
			{}
		);
	});

	it('throws for an unknown or disabled package', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedPackage(db, 'pkg-disabled', 3, 9, 9, 0);
		seedRate(db, 2000, 1000);

		await expect(
			createDeposit(db, 'user-1', fakeNwc, { packageId: 'pkg-disabled' })
		).rejects.toThrow('unknown or disabled package');
		await expect(
			createDeposit(db, 'user-1', fakeNwc, { packageId: 'does-not-exist' })
		).rejects.toThrow('unknown or disabled package');
	});
});

describe('markDepositPaid', () => {
	async function seedPendingDeposit(db: D1Database): Promise<void> {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 0);
		seedPackage(db, 'pkg-1', 1, 3, 5);
		seedRate(db, 2000, 1000);
		lightning.createInvoice.mockResolvedValueOnce({
			invoice: 'lnbc1...',
			paymentHash: 'hash-1',
			satsAmount: 2000,
			createdAt: 1,
			expiresAt: 601
		});
		await createDeposit(db, 'user-1', fakeNwc, { packageId: 'pkg-1' }, {}, 1000);
	}

	it('credits the user app_credit and the shared archai_token ledger exactly once', async () => {
		const db = makeD1();
		await seedPendingDeposit(db);

		const paid = await markDepositPaid(db, 'hash-1', 5000);

		expect(paid).toMatchObject({
			status: 'paid',
			paidAt: 5000,
			creditsAwarded: 3,
			archaiTokensAwarded: 5
		});
		expect(await readLedgerBalance(db, 'app_credit', 'user-1')).toBe(toLedgerAmountUnits(3));
		expect(await readLedgerBalance(db, 'archai_token', null)).toBe(toLedgerAmountUnits(5));
	});

	it('is idempotent when called again for an already-paid deposit', async () => {
		const db = makeD1();
		await seedPendingDeposit(db);
		await markDepositPaid(db, 'hash-1', 5000);

		const second = await markDepositPaid(db, 'hash-1', 9000);

		expect(second).toMatchObject({ status: 'paid', paidAt: 5000 });
		expect(await readLedgerBalance(db, 'app_credit', 'user-1')).toBe(toLedgerAmountUnits(3));
	});

	it('returns null for an unknown payment hash', async () => {
		const db = makeD1();
		expect(await markDepositPaid(db, 'no-such-hash')).toBeNull();
	});

	it('returns null and does not credit an expired deposit', async () => {
		const db = makeD1();
		await seedPendingDeposit(db);
		await expireStaleDeposits(db, Date.now() + 10 * 60 * 60 * 1000);

		expect(await markDepositPaid(db, 'hash-1')).toBeNull();
		expect(await readLedgerBalance(db, 'app_credit', 'user-1')).toBe(0);
	});
});

describe('getDeposit', () => {
	it('scopes lookup to the owning user', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedPackage(db, 'pkg-1', 1, 3, 3);
		seedRate(db, 2000, 1000);
		lightning.createInvoice.mockResolvedValueOnce({
			invoice: 'lnbc1...',
			paymentHash: 'hash-1',
			satsAmount: 2000,
			createdAt: 1,
			expiresAt: 601
		});
		const deposit = await createDeposit(db, 'user-1', fakeNwc, { packageId: 'pkg-1' }, {}, 1000);

		expect(await getDeposit(db, deposit.id, 'user-1')).toMatchObject({ id: deposit.id });
		expect(await getDeposit(db, deposit.id, 'user-2')).toBeNull();
	});
});

describe('expireStaleDeposits', () => {
	it('flips only overdue pending deposits', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedPackage(db, 'pkg-1', 1, 3, 3);
		seedRate(db, 2000, 1000);
		lightning.createInvoice.mockResolvedValueOnce({
			invoice: 'lnbc1...',
			paymentHash: 'hash-1',
			satsAmount: 2000,
			createdAt: 1,
			expiresAt: 601
		});
		const deposit = await createDeposit(
			db,
			'user-1',
			fakeNwc,
			{ packageId: 'pkg-1', expirySeconds: 60 },
			{},
			1000
		);

		const changed = await expireStaleDeposits(db, deposit.createdAt + 61_000);

		expect(changed).toBe(1);
		expect(await getDeposit(db, deposit.id, 'user-1')).toMatchObject({ status: 'expired' });
	});
});
