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
import type { CreateDepositRequest } from '$lib/api/contract';
import { getUsdExchangeRate } from '$lib/server/exchange-rate';
import {
	createLnbitsInvoice,
	findLnbitsInvoiceByAttempt,
	LnbitsError,
	lookupLnbitsPayment,
	type LnbitsConfig,
	type LnbitsInvoice,
	type LnbitsPaymentStatus
} from '$lib/server/lnbits';
import {
	claimDepositForInvoiceCreation,
	createDepositIntent,
	finalizeDeposit,
	getDeposit,
	INVOICE_EXPIRY_SECONDS,
	recordDepositExpired,
	recordDepositFailed,
	recordDepositInvoice,
	recordDepositPending,
	recordDepositProviderError,
	recordDepositRate,
	recordProviderSettlement,
	type Deposit
} from '$lib/server/payments';

export interface DepositReconciliationOptions {
	now?: number;
	getExchangeRate?: typeof getUsdExchangeRate;
	createInvoice?: typeof createLnbitsInvoice;
	findInvoiceByAttempt?: typeof findLnbitsInvoiceByAttempt;
	lookupPayment?: typeof lookupLnbitsPayment;
}

function providerErrorData(error: unknown): {
	operation: string;
	outcome: string;
	errorName: string;
} {
	return error instanceof LnbitsError
		? { operation: error.operation, outcome: error.outcome, errorName: error.name }
		: { operation: 'unknown', outcome: 'ambiguous', errorName: 'Error' };
}

function shouldRetry(error: unknown): boolean {
	return !(error instanceof LnbitsError) || error.outcome === 'ambiguous';
}

async function prepareInvoice(
	db: D1Database,
	deposit: Deposit,
	config: LnbitsConfig,
	now: number,
	recoverFirst: boolean,
	options: DepositReconciliationOptions
): Promise<Deposit> {
	let current = deposit;
	if (current.satsAmount === null) {
		const rate = await (options.getExchangeRate ?? getUsdExchangeRate)(db, config, now);
		const satsAmount = Math.max(1, Math.ceil(current.usdAmount * rate.satsPerUsd));
		current = await recordDepositRate(db, current, rate.satsPerUsd, satsAmount, now);
	}
	if (current.satsAmount === null) throw new Error('deposit_amount_missing');

	const recovered = recoverFirst
		? await (options.findInvoiceByAttempt ?? findLnbitsInvoiceByAttempt)(
				config,
				current.id,
				current.createdAt
			)
		: null;
	const invoice: LnbitsInvoice =
		recovered ??
		(await (options.createInvoice ?? createLnbitsInvoice)(config, {
			attemptId: current.id,
			satsAmount: current.satsAmount,
			memo: `Cadbos ${current.packageId}`,
			expirySeconds: INVOICE_EXPIRY_SECONDS
		}));
	if (invoice.satsAmount !== current.satsAmount) {
		throw new LnbitsError('recover_invoice', 'explicit_failure', 'LNbits invoice amount mismatch');
	}
	return recordDepositInvoice(db, current, invoice, now);
}

function assertPaymentIdentity(deposit: Deposit, payment: LnbitsPaymentStatus): void {
	if (payment.paymentHash !== deposit.paymentHash) {
		throw new LnbitsError('lookup_payment', 'explicit_failure', 'LNbits payment hash mismatch');
	}
	if (payment.checkingId !== deposit.checkingId) {
		throw new LnbitsError('lookup_payment', 'explicit_failure', 'LNbits checking ID mismatch');
	}
	if (payment.satsAmount !== deposit.satsAmount) {
		throw new LnbitsError('lookup_payment', 'explicit_failure', 'LNbits payment amount mismatch');
	}
	const consistent =
		(payment.paid && payment.status === 'success' && payment.state === 'paid') ||
		(!payment.paid && payment.status === 'pending' && payment.state === 'pending') ||
		(!payment.paid && payment.status === 'failed' && payment.state === 'failed');
	if (!consistent) {
		throw new LnbitsError('lookup_payment', 'explicit_failure', 'LNbits payment state mismatch');
	}
}

export function depositNeedsReconciliation(deposit: Deposit, now: number = Date.now()): boolean {
	if (deposit.status === 'creating') {
		return (
			deposit.reconcileAfter !== null &&
			deposit.reconcileAfter <= now &&
			(deposit.invoiceCreationLeaseUntil === null || deposit.invoiceCreationLeaseUntil <= now)
		);
	}
	if (deposit.status === 'pending') return true;
	return deposit.status === 'expired' && deposit.reconcileAfter !== null;
}

export async function reconcileClaimedDeposit(
	db: D1Database,
	deposit: Deposit,
	config: LnbitsConfig,
	options: DepositReconciliationOptions = {}
): Promise<Deposit> {
	const now = options.now ?? Date.now();
	if (deposit.status === 'paid') return deposit;
	if (deposit.status === 'creating') {
		try {
			return await prepareInvoice(db, deposit, config, now, deposit.satsAmount !== null, options);
		} catch (error) {
			const retry = shouldRetry(error);
			const recorded = await recordDepositProviderError(
				db,
				deposit.id,
				providerErrorData(error),
				now,
				retry
			);
			if (!retry) return recorded;
			throw error;
		}
	}
	if (!deposit.checkingId || !deposit.paymentHash || deposit.satsAmount === null) {
		throw new Error('deposit_invoice_missing');
	}

	try {
		const payment = await (options.lookupPayment ?? lookupLnbitsPayment)(
			config,
			deposit.paymentHash
		);
		assertPaymentIdentity(deposit, payment);
		if (payment.state === 'paid') {
			const paidAt = await recordProviderSettlement(db, deposit.id, now);
			return await finalizeDeposit(db, deposit.id, paidAt, now);
		}
		if (payment.state === 'failed') return recordDepositFailed(db, deposit.id, now);
		if (deposit.expiresAt !== null && deposit.expiresAt <= now) {
			return recordDepositExpired(db, deposit.id, now);
		}
		return recordDepositPending(db, deposit.id, now);
	} catch (error) {
		const retry = shouldRetry(error);
		const recorded = await recordDepositProviderError(
			db,
			deposit.id,
			providerErrorData(error),
			now,
			retry
		);
		if (!retry) return recorded;
		throw error;
	}
}

export async function createOrResumeDeposit(
	db: D1Database,
	userId: string,
	input: CreateDepositRequest,
	config: LnbitsConfig,
	options: DepositReconciliationOptions = {}
): Promise<Deposit> {
	const now = options.now ?? Date.now();
	const deposit = await createDepositIntent(db, userId, input.requestId, input.packageId, now);
	if (deposit.status !== 'creating') return deposit;
	const claimed = await claimDepositForInvoiceCreation(db, deposit.id, now);
	if (claimed) return reconcileClaimedDeposit(db, claimed, config, { ...options, now });
	const latest = await getDeposit(db, deposit.id, userId);
	if (!latest) throw new Error('deposit_disappeared_after_invoice_claim');
	return latest;
}

export async function reconcileDeposit(
	db: D1Database,
	deposit: Deposit,
	config: LnbitsConfig,
	options: DepositReconciliationOptions = {}
): Promise<Deposit> {
	const now = options.now ?? Date.now();
	if (deposit.status !== 'creating') {
		return reconcileClaimedDeposit(db, deposit, config, { ...options, now });
	}
	const claimed = await claimDepositForInvoiceCreation(db, deposit.id, now);
	if (claimed) return reconcileClaimedDeposit(db, claimed, config, { ...options, now });
	const latest = await getDeposit(db, deposit.id, deposit.userId);
	if (!latest) throw new Error('deposit_disappeared_after_invoice_claim');
	return latest;
}
