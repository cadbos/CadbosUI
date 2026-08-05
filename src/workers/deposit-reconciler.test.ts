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
import { createDepositIntent, type Deposit } from '$lib/server/payments';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { reconcileDueDeposits, type DepositReconcilerEnv } from './deposit-reconciler';

const NOW = 1_800_000_000_000;
let db: D1Database;

function env(overrides: Partial<DepositReconcilerEnv> = {}): DepositReconcilerEnv {
	return {
		DB: db,
		LNBITS_BASE_URL: 'https://lnbits.example.test',
		LNBITS_INVOICE_KEY: 'invoice-key',
		...overrides
	};
}

async function seedCreating(count: number): Promise<Deposit[]> {
	const deposits: Deposit[] = [];
	for (let index = 0; index < count; index += 1) {
		deposits.push(
			await createDepositIntent(db, 'user-1', crypto.randomUUID(), 'pkg-1', NOW + index)
		);
	}
	return deposits;
}

beforeEach(() => {
	db = makeD1();
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', NOW)
		.run();
});

describe('reconcileDueDeposits', () => {
	it('claims at most 25 deposits and performs no more than five operations concurrently', async () => {
		await seedCreating(26);
		let active = 0;
		let maximum = 0;
		const reconcile = vi.fn(async (_db, deposit: Deposit) => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise<void>((resolve) => queueMicrotask(resolve));
			active -= 1;
			return { ...deposit, status: 'pending' as const };
		});

		const summary = await reconcileDueDeposits(env(), NOW + 100, { reconcile });

		expect(summary).toEqual({ claimed: 25, paid: 0, pending: 25, terminal: 0, errors: 0 });
		expect(reconcile).toHaveBeenCalledTimes(25);
		expect(maximum).toBe(5);
		expect(
			await db
				.prepare(
					'SELECT COUNT(*) AS count FROM deposits WHERE invoice_creation_lease_until = ? AND reconcile_after = ?'
				)
				.bind(NOW + 100 + 180_000, NOW + 100 + 180_000)
				.first()
		).toEqual({ count: 25 });
	});

	it('summarizes failures without emitting per-deposit data', async () => {
		await seedCreating(2);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const reconcile = vi
			.fn()
			.mockRejectedValueOnce(new Error('provider secret detail'))
			.mockImplementationOnce(async (_db, deposit: Deposit) => ({
				...deposit,
				status: 'failed' as const
			}));

		const summary = await reconcileDueDeposits(env(), NOW + 100, { reconcile });

		expect(summary).toEqual({ claimed: 2, paid: 0, pending: 0, terminal: 1, errors: 1 });
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it('fails before claiming deposits when LNbits configuration is missing', async () => {
		const [deposit] = await seedCreating(1);

		await expect(reconcileDueDeposits(env({ LNBITS_BASE_URL: '' }), NOW + 100)).rejects.toThrow(
			'LNbits is not configured'
		);
		expect(
			await db.prepare('SELECT reconcile_after FROM deposits WHERE id = ?').bind(deposit.id).first()
		).toEqual({ reconcile_after: deposit.reconcileAfter });
	});
});
