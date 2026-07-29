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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toLedgerAmountUnits } from './ledger-units';
import { makeD1 } from './testing/d1-shim';

const lightning = vi.hoisted(() => ({
	createInvoice: vi.fn(),
	lookupInvoice: vi.fn()
}));
vi.mock('$lib/server/lightning', () => lightning);

const { reconcileDeposit } = await import('./deposit-reconciliation');
const { createDeposit, getDeposit } = await import('./payments');

const connection = {} as never;
const RECONCILIATION_NOW = 1_000_000;

async function seedDeposit(db: D1Database): Promise<Awaited<ReturnType<typeof createDeposit>>> {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1000)
		.run();
	db.prepare(
		'INSERT INTO exchange_rate_cache (provider, sats_per_usd, fetched_at, expires_at) VALUES (?, ?, ?, ?)'
	)
		.bind('kraken', 2000, 1000, 91_000)
		.run();
	lightning.createInvoice.mockResolvedValueOnce({
		invoice: 'lnbc1...',
		paymentHash: 'hash-1',
		satsAmount: 2000,
		createdAt: 1,
		expiresAt: 901
	});
	return createDeposit(db, 'user-1', connection, { packageId: 'pkg-1' }, {}, 1000);
}

beforeEach(() => {
	lightning.createInvoice.mockReset();
	lightning.lookupInvoice.mockReset();
});

describe('reconcileDeposit', () => {
	it('recovers a locally expired deposit from an authoritative settlement', async () => {
		const db = makeD1();
		const deposit = await seedDeposit(db);
		db.prepare("UPDATE deposits SET status = 'expired' WHERE id = ?").bind(deposit.id).run();

		const reconciled = await reconcileDeposit(db, { ...deposit, status: 'expired' }, connection, {
			now: RECONCILIATION_NOW,
			lookup: vi.fn().mockResolvedValue({
				state: 'settled',
				paymentHash: 'hash-1',
				settledAt: 90
			})
		});

		expect(reconciled).toMatchObject({
			status: 'paid',
			paidAt: 90_000,
			providerCheckedAt: RECONCILIATION_NOW,
			reconcileAfter: null
		});
		expect(
			await db
				.prepare(
					'SELECT balance.balance FROM ledger_accounts account ' +
						'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
						"WHERE account.user_id = ? AND account.asset = 'app_credit'"
				)
				.bind('user-1')
				.first<{ balance: number }>()
		).toEqual({ balance: toLedgerAmountUnits(3) });
	});

	it('keeps an overdue invoice pending when the wallet has not finalized it', async () => {
		const db = makeD1();
		const deposit = await seedDeposit(db);

		const reconciled = await reconcileDeposit(db, deposit, connection, {
			now: RECONCILIATION_NOW,
			lookup: vi.fn().mockResolvedValue({
				state: 'accepted',
				paymentHash: 'hash-1',
				settledAt: null
			})
		});

		expect(reconciled).toMatchObject({
			status: 'pending',
			providerCheckedAt: RECONCILIATION_NOW,
			reconcileAfter: RECONCILIATION_NOW + 60_000
		});
	});

	it('stores an authoritative expired state as final', async () => {
		const db = makeD1();
		const deposit = await seedDeposit(db);

		const reconciled = await reconcileDeposit(db, deposit, connection, {
			now: RECONCILIATION_NOW,
			lookup: vi.fn().mockResolvedValue({
				state: 'expired',
				paymentHash: 'hash-1',
				settledAt: null
			})
		});

		expect(reconciled).toMatchObject({
			status: 'expired',
			providerCheckedAt: RECONCILIATION_NOW,
			reconcileAfter: null
		});
	});

	it('rejects a mismatched wallet response without changing the deposit', async () => {
		const db = makeD1();
		const deposit = await seedDeposit(db);

		await expect(
			reconcileDeposit(db, deposit, connection, {
				now: RECONCILIATION_NOW,
				lookup: vi.fn().mockResolvedValue({
					state: 'settled',
					paymentHash: 'different-hash',
					settledAt: 90
				})
			})
		).rejects.toThrow('mismatched payment hash');
		expect(await getDeposit(db, deposit.id, 'user-1')).toMatchObject({
			status: 'pending',
			providerCheckedAt: null
		});
	});
});
