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

import { beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { getCredit } from '$lib/server/billing';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	claimDepositForInvoiceCreation,
	createDepositIntent,
	finalizeDeposit,
	getDeposit,
	recordDepositExpired,
	recordDepositInvoice,
	recordDepositProviderError,
	recordDepositRate,
	recordProviderSettlement
} from './payments';

const NOW = 1_800_000_000_000;
const PAYMENT_HASH = 'a'.repeat(64);
let db: D1Database;

function seedUser(): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', NOW)
		.run();
}

async function pendingDeposit(): Promise<Awaited<ReturnType<typeof getDeposit>>> {
	const intent = await createDepositIntent(db, 'user-1', crypto.randomUUID(), 'pkg-1', NOW);
	const rated = await recordDepositRate(db, intent, 1_200, 1_200, NOW + 1);
	return recordDepositInvoice(
		db,
		rated,
		{
			checkingId: 'checking-1',
			paymentHash: PAYMENT_HASH,
			bolt11: 'lnbc12u1test',
			satsAmount: 1_200
		},
		NOW + 2
	);
}

beforeEach(() => {
	db = makeD1();
	seedUser();
});

describe('payment accounting', () => {
	it('applies the additive invoice creation lease with a nullable positive constraint', async () => {
		const intent = await createDepositIntent(db, 'user-1', crypto.randomUUID(), 'pkg-1', NOW);
		expect(
			await db
				.prepare("SELECT name FROM pragma_table_info('deposits') WHERE name = ?")
				.bind('invoice_creation_lease_until')
				.first()
		).toEqual({ name: 'invoice_creation_lease_until' });
		expect(() =>
			db
				.prepare('UPDATE deposits SET invoice_creation_lease_until = 0 WHERE id = ?')
				.bind(intent.id)
				.run()
		).toThrow();
		expect(() =>
			db
				.prepare('UPDATE deposits SET invoice_creation_lease_until = NULL WHERE id = ?')
				.bind(intent.id)
				.run()
		).not.toThrow();
	});

	it('credits a late-settled invoice exactly once with balanced entries', async () => {
		const pending = await pendingDeposit();
		if (!pending) throw new Error('pending deposit missing');
		const expired = await recordDepositExpired(db, pending.id, NOW + 901_000);
		expect(expired.reconcileAfter).toBe(NOW + 961_000);
		const paidAt = await recordProviderSettlement(db, pending.id, NOW + 901_001);

		const first = await finalizeDeposit(db, pending.id, paidAt, NOW + 901_002);
		const second = await finalizeDeposit(db, pending.id, paidAt, NOW + 901_003);

		expect(first.status).toBe('paid');
		expect(first.paidAt).toBe(NOW + 901_001);
		expect(second.ledgerTransactionId).toBe(first.ledgerTransactionId);
		await expect(getCredit(db, 'user-1')).resolves.toMatchObject({ balance: 3, enabled: true });
		const totals = await db
			.prepare(
				'SELECT account.asset, SUM(entry.amount) AS total, COUNT(*) AS count ' +
					'FROM ledger_entries entry JOIN ledger_accounts account ON account.id = entry.account_id ' +
					'WHERE entry.transaction_id = ? GROUP BY account.asset ORDER BY account.asset'
			)
			.bind(first.ledgerTransactionId)
			.all<{ asset: string; total: number; count: number }>();
		expect(totals).toEqual({
			results: [
				{ asset: 'app_credit', total: 0, count: 2 },
				{ asset: 'archai_token', total: 0, count: 2 }
			]
		});
		expect(
			await db
				.prepare("SELECT COUNT(*) AS count FROM ledger_transactions WHERE id = 'deposit:' || ?")
				.bind(pending.id)
				.first<{ count: number }>()
		).toEqual({ count: 1 });
		expect(
			await db
				.prepare(
					"SELECT COUNT(*) AS count FROM payment_events WHERE deposit_id = ? AND type = 'ledger_posted'"
				)
				.bind(pending.id)
				.first<{ count: number }>()
		).toEqual({ count: 1 });
		expect(() =>
			db.prepare('UPDATE deposits SET reconcile_after = ? WHERE id = ?').bind(NOW, pending.id).run()
		).toThrow('paid deposits are immutable');
	});

	it('serializes invoice creation until the three-minute lease expires', async () => {
		const intent = await createDepositIntent(db, 'user-1', crypto.randomUUID(), 'pkg-1', NOW);

		const first = await claimDepositForInvoiceCreation(db, intent.id, NOW);
		const contended = await claimDepositForInvoiceCreation(db, intent.id, NOW + 1);
		const reclaimed = await claimDepositForInvoiceCreation(db, intent.id, NOW + 180_000);

		expect(first).toMatchObject({
			status: 'creating',
			reconcileAfter: NOW + 180_000,
			invoiceCreationLeaseUntil: NOW + 180_000
		});
		expect(contended).toBeNull();
		expect(reclaimed).toMatchObject({
			reconcileAfter: NOW + 360_000,
			invoiceCreationLeaseUntil: NOW + 360_000
		});
	});

	it('reuses the first verified-provider timestamp from the immutable event', async () => {
		const pending = await pendingDeposit();
		if (!pending) throw new Error('pending deposit missing');

		const first = await recordProviderSettlement(db, pending.id, NOW + 10);
		const retried = await recordProviderSettlement(db, pending.id, NOW + 20);

		expect(first).toBe(NOW + 10);
		expect(retried).toBe(first);
		expect(
			await db
				.prepare(
					"SELECT COUNT(*) AS count FROM payment_events WHERE deposit_id = ? AND type = 'provider_paid'"
				)
				.bind(pending.id)
				.first()
		).toEqual({ count: 1 });
	});

	it('preserves the invoice snapshot and an append-only error trail', async () => {
		const pending = await pendingDeposit();
		if (!pending) throw new Error('pending deposit missing');

		const afterError = await recordDepositProviderError(
			db,
			pending.id,
			{ operation: 'lookup_payment', outcome: 'ambiguous', errorName: 'LnbitsError' },
			NOW + 10,
			true
		);

		expect(afterError).toMatchObject({
			status: 'pending',
			checkingId: pending.checkingId,
			paymentHash: pending.paymentHash,
			bolt11: pending.bolt11,
			satsAmount: pending.satsAmount
		});
		expect(
			await db
				.prepare(
					"SELECT COUNT(*) AS count FROM payment_events WHERE deposit_id = ? AND type = 'provider_error'"
				)
				.bind(pending.id)
				.first<{ count: number }>()
		).toEqual({ count: 1 });
		expect(() =>
			db
				.prepare('UPDATE payment_events SET data = ? WHERE deposit_id = ?')
				.bind('{}', pending.id)
				.run()
		).toThrow('payment events are immutable');
		expect(() => db.prepare('DELETE FROM deposits WHERE id = ?').bind(pending.id).run()).toThrow(
			'deposits are immutable'
		);
	});
});
