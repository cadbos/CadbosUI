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
import { makeD1 } from '$lib/server/testing/d1-shim';

const lightning = vi.hoisted(() => ({
	parseNwcConnectionString: vi.fn(() => ({
		walletPubkey: 'wallet',
		relays: ['wss://relay.example.test'],
		clientSecretKey: new Uint8Array(32),
		clientPubkey: 'client'
	})),
	lookupInvoice: vi.fn()
}));
vi.mock('$lib/server/lightning', () => lightning);

const { reconcileDueDeposits } = await import('./deposit-reconciler');

function seedAccount(db: D1Database): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1000)
		.run();
}

function seedDeposit(
	db: D1Database,
	id: string,
	status: 'pending' | 'expired' | 'failed' = 'pending',
	providerCheckedAt: number | null = null,
	reconcileAfter: number | null = 1000
): void {
	db.prepare(
		'INSERT INTO deposits (' +
			'id, user_id, package_id, provider, provider_invoice_id, payment_hash, sats_amount, ' +
			'usd_amount, sats_per_usd_rate, credits_awarded, archai_tokens_awarded, status, created_at, ' +
			'expires_at, provider_checked_at, reconcile_after' +
			') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	)
		.bind(
			id,
			'user-1',
			'pkg-1',
			'nwc',
			`invoice-${id}`,
			`hash-${id}`,
			2000,
			1,
			2000,
			3,
			3,
			status,
			1000,
			61_000,
			providerCheckedAt,
			reconcileAfter
		)
		.run();
}

beforeEach(() => {
	lightning.parseNwcConnectionString.mockClear();
	lightning.lookupInvoice.mockReset();
});

describe('reconcileDueDeposits', () => {
	it('settles pending and legacy-expired deposits while skipping confirmed terminal rows', async () => {
		const db = makeD1();
		seedAccount(db);
		seedDeposit(db, 'pending');
		seedDeposit(db, 'legacy-expired', 'expired');
		seedDeposit(db, 'confirmed-expired', 'expired', 90_000, null);
		lightning.lookupInvoice.mockImplementation(async (_connection, paymentHash: string) => ({
			state: paymentHash === 'hash-pending' ? 'settled' : 'expired',
			paymentHash,
			settledAt: paymentHash === 'hash-pending' ? 90 : null
		}));

		const summary = await reconcileDueDeposits(
			{ DB: db, NWC_CONNECTION_STRING: 'connection' },
			100_000
		);

		expect(summary).toEqual({ claimed: 2, paid: 1, pending: 0, terminal: 1, errors: 0 });
		expect(lightning.lookupInvoice).toHaveBeenCalledTimes(2);
		expect(
			await db
				.prepare('SELECT status FROM deposits WHERE id = ?')
				.bind('pending')
				.first<{ status: string }>()
		).toEqual({ status: 'paid' });
		expect(
			await db
				.prepare('SELECT status, provider_checked_at FROM deposits WHERE id = ?')
				.bind('legacy-expired')
				.first<{ status: string; provider_checked_at: number }>()
		).toEqual({ status: 'expired', provider_checked_at: 100_000 });
	});

	it('continues the batch after one lookup fails and leaves the failed item leased', async () => {
		const db = makeD1();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		seedAccount(db);
		seedDeposit(db, 'failure');
		seedDeposit(db, 'pending');
		lightning.lookupInvoice.mockImplementation(async (_connection, paymentHash: string) => {
			if (paymentHash === 'hash-failure') throw new Error('relay unavailable');
			return { state: 'pending', paymentHash, settledAt: null };
		});

		const summary = await reconcileDueDeposits(
			{ DB: db, NWC_CONNECTION_STRING: 'connection' },
			100_000
		);

		expect(summary).toEqual({ claimed: 2, paid: 0, pending: 1, terminal: 0, errors: 1 });
		expect(
			await db
				.prepare('SELECT reconcile_after FROM deposits WHERE id = ?')
				.bind('failure')
				.first<{ reconcile_after: number }>()
		).toEqual({ reconcile_after: 220_000 });
		expect(
			await db
				.prepare('SELECT reconcile_after FROM deposits WHERE id = ?')
				.bind('pending')
				.first<{ reconcile_after: number }>()
		).toEqual({ reconcile_after: 160_000 });
		expect(consoleError).toHaveBeenCalledOnce();
		consoleError.mockRestore();
	});

	it('claims at most twenty deposits per scheduled run', async () => {
		const db = makeD1();
		seedAccount(db);
		for (let index = 0; index < 21; index += 1) seedDeposit(db, `deposit-${index}`);
		lightning.lookupInvoice.mockImplementation(async (_connection, paymentHash: string) => ({
			state: 'pending',
			paymentHash,
			settledAt: null
		}));

		const summary = await reconcileDueDeposits(
			{ DB: db, NWC_CONNECTION_STRING: 'connection' },
			100_000
		);

		expect(summary.claimed).toBe(20);
		expect(summary.pending).toBe(20);
		expect(lightning.lookupInvoice).toHaveBeenCalledTimes(20);
	});

	it('fails closed when its wallet secret is missing', async () => {
		await expect(reconcileDueDeposits({ DB: makeD1() }, 100_000)).rejects.toThrow(
			'NWC connection is not configured'
		);
	});
});
