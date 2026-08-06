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
import { getCredit } from '$lib/server/billing';
import {
	LnbitsError,
	type LnbitsFetch,
	type LnbitsInvoice,
	type LnbitsPaymentStatus
} from './lnbits';
import {
	createDepositIntent,
	getDeposit,
	recordDepositExpired,
	recordDepositInvoice,
	recordDepositRate,
	type Deposit
} from './payments';
import { makeD1 } from './testing/d1-shim';
import { createOrResumeDeposit, reconcileClaimedDeposit } from './deposit-reconciliation';

const NOW = 1_800_000_000_000;
const PAYMENT_HASH = 'a'.repeat(64);
const config = { fetcher: vi.fn<LnbitsFetch>(), invoiceKey: 'invoice-key' };
const invoice: LnbitsInvoice = {
	checkingId: 'checking-1',
	paymentHash: PAYMENT_HASH,
	bolt11: 'lnbc12u1test',
	satsAmount: 1_200
};
let db: D1Database;

function seedUser(): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', NOW)
		.run();
}

async function pendingDeposit(): Promise<Deposit> {
	const intent = await createDepositIntent(db, 'user-1', crypto.randomUUID(), 'pkg-1', NOW);
	const rated = await recordDepositRate(db, intent, 1_200, 1_200, NOW + 1);
	return recordDepositInvoice(db, rated, invoice, NOW + 2);
}

function payment(overrides: Partial<LnbitsPaymentStatus> = {}): LnbitsPaymentStatus {
	return {
		checkingId: invoice.checkingId,
		paymentHash: invoice.paymentHash,
		state: 'paid',
		satsAmount: invoice.satsAmount,
		paid: true,
		status: 'success',
		...overrides
	};
}

beforeEach(() => {
	db = makeD1();
	seedUser();
});

describe('deposit invoice creation', () => {
	it('creates exactly one LNbits invoice for simultaneous uses of one request ID', async () => {
		const requestId = crypto.randomUUID();
		const createInvoice = vi.fn().mockResolvedValue(invoice);
		const options = {
			now: NOW,
			getExchangeRate: vi.fn().mockResolvedValue({ usdPerBtc: 100_000, satsPerUsd: 1_200 }),
			createInvoice,
			findInvoiceByAttempt: vi.fn()
		};

		const results = await Promise.all([
			createOrResumeDeposit(db, 'user-1', { requestId, packageId: 'pkg-1' }, config, options),
			createOrResumeDeposit(db, 'user-1', { requestId, packageId: 'pkg-1' }, config, options)
		]);

		expect(createInvoice).toHaveBeenCalledOnce();
		expect(new Set(results.map((result) => result.id))).toEqual(new Set([results[0].id]));
		expect(new Set(results.map((result) => result.status))).toEqual(
			new Set(['creating', 'pending'])
		);
		expect(options.findInvoiceByAttempt).not.toHaveBeenCalled();
		await expect(getDeposit(db, results[0].id)).resolves.toMatchObject({
			status: 'pending',
			paymentHash: PAYMENT_HASH
		});
	});

	it('returns the stored creating attempt to a caller that loses the lease', async () => {
		const requestId = crypto.randomUUID();
		const intent = await createDepositIntent(db, 'user-1', requestId, 'pkg-1', NOW);
		db.prepare(
			'UPDATE deposits SET invoice_creation_lease_until = ?, reconcile_after = ? WHERE id = ?'
		)
			.bind(NOW + 180_000, NOW + 180_000, intent.id)
			.run();
		const createInvoice = vi.fn();

		const result = await createOrResumeDeposit(
			db,
			'user-1',
			{ requestId, packageId: 'pkg-1' },
			config,
			{ now: NOW + 1, createInvoice }
		);

		expect(result).toMatchObject({
			id: intent.id,
			status: 'creating',
			invoiceCreationLeaseUntil: NOW + 180_000
		});
		expect(createInvoice).not.toHaveBeenCalled();
	});

	it('recovers an ambiguous successful creation without issuing a duplicate invoice', async () => {
		const requestId = crypto.randomUUID();
		const createInvoice = vi
			.fn()
			.mockRejectedValueOnce(
				new LnbitsError('create_invoice', 'ambiguous', 'response was lost after creation')
			);
		const getExchangeRate = vi.fn().mockResolvedValue({ usdPerBtc: 100_000, satsPerUsd: 1_200 });

		await expect(
			createOrResumeDeposit(db, 'user-1', { requestId, packageId: 'pkg-1' }, config, {
				now: NOW,
				getExchangeRate,
				createInvoice
			})
		).rejects.toMatchObject({ outcome: 'ambiguous' });
		const interrupted = await db
			.prepare(
				'SELECT id, sats_amount, invoice_creation_lease_until FROM deposits WHERE request_id = ?'
			)
			.bind(requestId)
			.first<{ id: string; sats_amount: number; invoice_creation_lease_until: number | null }>();
		expect(interrupted).toMatchObject({
			sats_amount: 1_200,
			invoice_creation_lease_until: null
		});
		if (!interrupted) throw new Error('interrupted deposit missing');
		const findInvoiceByAttempt = vi
			.fn()
			.mockRejectedValueOnce(
				new LnbitsError('list_payments', 'ambiguous', 'payment history request failed')
			)
			.mockResolvedValueOnce(invoice);

		await expect(
			createOrResumeDeposit(db, 'user-1', { requestId, packageId: 'pkg-1' }, config, {
				now: NOW + 60_000,
				getExchangeRate,
				createInvoice,
				findInvoiceByAttempt
			})
		).rejects.toMatchObject({ outcome: 'ambiguous' });

		const recovered = await createOrResumeDeposit(
			db,
			'user-1',
			{ requestId, packageId: 'pkg-1' },
			config,
			{ now: NOW + 120_000, getExchangeRate, createInvoice, findInvoiceByAttempt }
		);

		expect(recovered.status).toBe('pending');
		expect(findInvoiceByAttempt).toHaveBeenCalledTimes(2);
		expect(findInvoiceByAttempt).toHaveBeenCalledWith(config, interrupted.id, NOW);
		expect(createInvoice).toHaveBeenCalledOnce();
		expect(getExchangeRate).toHaveBeenCalledOnce();
	});
});

describe('claimed payment reconciliation', () => {
	it.each([
		['payment hash', { paymentHash: 'b'.repeat(64) }],
		['checking ID', { checkingId: 'checking-other' }],
		['amount', { satsAmount: 1_201 }],
		['state fields', { state: 'pending', paid: true, status: 'success' }]
	] as const)('rejects a mismatched %s without crediting', async (_label, overrides) => {
		const pending = await pendingDeposit();

		const result = await reconcileClaimedDeposit(db, pending, config, {
			now: NOW + 10,
			lookupPayment: vi.fn().mockResolvedValue(payment(overrides))
		});

		expect(result.status).toBe('failed');
		await expect(getCredit(db, 'user-1')).resolves.toBeNull();
		expect(
			await db
				.prepare(
					"SELECT COUNT(*) AS count FROM payment_events WHERE deposit_id = ? AND type = 'provider_error'"
				)
				.bind(pending.id)
				.first()
		).toEqual({ count: 1 });
	});

	it('credits a late-settled expired invoice exactly once', async () => {
		const pending = await pendingDeposit();
		const expired = await recordDepositExpired(db, pending.id, NOW + 901_000);
		const lookupPayment = vi.fn().mockResolvedValue(payment());

		const first = await reconcileClaimedDeposit(db, expired, config, {
			now: NOW + 901_001,
			lookupPayment
		});
		const second = await reconcileClaimedDeposit(db, first, config, {
			now: NOW + 901_002,
			lookupPayment
		});

		expect(first.status).toBe('paid');
		expect(second.ledgerTransactionId).toBe(first.ledgerTransactionId);
		await expect(getCredit(db, 'user-1')).resolves.toMatchObject({ balance: 3 });
		expect(lookupPayment).toHaveBeenCalledOnce();
	});

	it('preserves first verification time when ledger finalization fails and is retried', async () => {
		const pending = await pendingDeposit();
		const baseDb = db;
		let rejectFinalization = true;
		const failingDb = new Proxy(baseDb, {
			get(target, property, receiver) {
				if (property !== 'batch') return Reflect.get(target, property, receiver);
				return (statements: Array<{ sql?: string }>) => {
					if (
						rejectFinalization &&
						statements.some((statement) =>
							statement.sql?.includes('INSERT INTO ledger_transactions')
						)
					) {
						rejectFinalization = false;
						throw new Error('injected ledger failure');
					}
					return baseDb.batch(statements as never);
				};
			}
		}) as D1Database;
		const lookupPayment = vi.fn().mockResolvedValue(payment());

		await expect(
			reconcileClaimedDeposit(failingDb, pending, config, {
				now: NOW + 10,
				lookupPayment
			})
		).rejects.toThrow('injected ledger failure');
		const retryable = await getDeposit(baseDb, pending.id);
		if (!retryable) throw new Error('retryable deposit missing');
		const paid = await reconcileClaimedDeposit(baseDb, retryable, config, {
			now: NOW + 20,
			lookupPayment
		});

		expect(paid).toMatchObject({ status: 'paid', paidAt: NOW + 10 });
		expect(
			await baseDb
				.prepare('SELECT occurred_at FROM ledger_transactions WHERE id = ?')
				.bind(paid.ledgerTransactionId)
				.first()
		).toEqual({ occurred_at: NOW + 10 });
		expect(
			await baseDb
				.prepare(
					"SELECT COUNT(*) AS count FROM payment_events WHERE deposit_id = ? AND type = 'provider_paid'"
				)
				.bind(pending.id)
				.first()
		).toEqual({ count: 1 });
	});
});
