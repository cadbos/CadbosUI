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

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { DepositResponse, DepositStatus, PackageRecord } from '$lib/api/contract';
import { getCredit } from '$lib/server/billing';
import { fromLedgerAmountUnits } from '$lib/server/ledger-units';
import type { LnbitsInvoice } from '$lib/server/lnbits';

export const INVOICE_EXPIRY_SECONDS = 15 * 60;
export const INVOICE_CREATION_LEASE_MS = 3 * 60_000;
export const RECONCILIATION_INTERVAL_MS = 60_000;
export const LATE_SETTLEMENT_GRACE_MS = 24 * 60 * 60_000;

interface PackageRow {
	id: string;
	usd_amount_cents: number;
	credits_awarded_units: number;
	archai_tokens_awarded_units: number;
}

export interface PaymentPackage extends PackageRecord {
	usdAmountCents: number;
	creditsAwardedUnits: number;
	archaiTokensAwardedUnits: number;
}

function toPackage(row: PackageRow): PaymentPackage {
	return {
		id: row.id,
		usdAmount: row.usd_amount_cents / 100,
		creditsAwarded: fromLedgerAmountUnits(row.credits_awarded_units),
		usdAmountCents: row.usd_amount_cents,
		creditsAwardedUnits: row.credits_awarded_units,
		archaiTokensAwardedUnits: row.archai_tokens_awarded_units
	};
}

export async function listPackages(db: D1Database): Promise<PackageRecord[]> {
	const { results } = await db
		.prepare(
			'SELECT id, usd_amount_cents, credits_awarded_units, archai_tokens_awarded_units ' +
				'FROM packages WHERE enabled = 1 ORDER BY usd_amount_cents, id'
		)
		.all<PackageRow>();
	return (results ?? []).map((row) => ({
		id: row.id,
		usdAmount: row.usd_amount_cents / 100,
		creditsAwarded: fromLedgerAmountUnits(row.credits_awarded_units)
	}));
}

async function getPackage(db: D1Database, packageId: string): Promise<PaymentPackage | null> {
	const row = await db
		.prepare(
			'SELECT id, usd_amount_cents, credits_awarded_units, archai_tokens_awarded_units ' +
				'FROM packages WHERE id = ? AND enabled = 1'
		)
		.bind(packageId)
		.first<PackageRow>();
	return row ? toPackage(row) : null;
}

interface DepositRow {
	id: string;
	request_id: string;
	user_id: string;
	package_id: string;
	provider: 'lnbits';
	provider_checking_id: string | null;
	payment_hash: string | null;
	bolt11: string | null;
	sats_amount: number | null;
	usd_amount_cents: number;
	sats_per_usd_rate: number | null;
	credits_awarded_units: number;
	archai_tokens_awarded_units: number;
	status: DepositStatus;
	created_at: number;
	expires_at: number | null;
	paid_at: number | null;
	provider_checked_at: number | null;
	reconcile_after: number | null;
	invoice_creation_lease_until: number | null;
	ledger_transaction_id: string | null;
}

export interface Deposit {
	id: string;
	requestId: string;
	userId: string;
	packageId: string;
	checkingId: string | null;
	paymentHash: string | null;
	bolt11: string | null;
	satsAmount: number | null;
	usdAmount: number;
	satsPerUsdRate: number | null;
	creditsAwardedUnits: number;
	archaiTokensAwardedUnits: number;
	status: DepositStatus;
	createdAt: number;
	expiresAt: number | null;
	paidAt: number | null;
	providerCheckedAt: number | null;
	reconcileAfter: number | null;
	invoiceCreationLeaseUntil: number | null;
	ledgerTransactionId: string | null;
}

function toDeposit(row: DepositRow): Deposit {
	return {
		id: row.id,
		requestId: row.request_id,
		userId: row.user_id,
		packageId: row.package_id,
		checkingId: row.provider_checking_id,
		paymentHash: row.payment_hash,
		bolt11: row.bolt11,
		satsAmount: row.sats_amount,
		usdAmount: row.usd_amount_cents / 100,
		satsPerUsdRate: row.sats_per_usd_rate,
		creditsAwardedUnits: row.credits_awarded_units,
		archaiTokensAwardedUnits: row.archai_tokens_awarded_units,
		status: row.status,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		paidAt: row.paid_at,
		providerCheckedAt: row.provider_checked_at,
		reconcileAfter: row.reconcile_after,
		invoiceCreationLeaseUntil: row.invoice_creation_lease_until,
		ledgerTransactionId: row.ledger_transaction_id
	};
}

export async function serializeDepositResponse(
	db: D1Database,
	deposit: Deposit
): Promise<DepositResponse> {
	const credit = deposit.status === 'paid' ? await getCredit(db, deposit.userId) : null;
	return {
		id: deposit.id,
		status: deposit.status,
		...(deposit.bolt11 ? { bolt11: deposit.bolt11 } : {}),
		...(deposit.satsAmount === null ? {} : { satsAmount: deposit.satsAmount }),
		...(deposit.expiresAt === null ? {} : { expiresAt: deposit.expiresAt }),
		usdAmount: deposit.usdAmount,
		...(credit ? { balance: credit.balance } : {})
	};
}

export async function getDeposit(
	db: D1Database,
	id: string,
	userId?: string
): Promise<Deposit | null> {
	const row = await db
		.prepare(`SELECT * FROM deposits WHERE id = ?${userId ? ' AND user_id = ?' : ''}`)
		.bind(...(userId ? [id, userId] : [id]))
		.first<DepositRow>();
	return row ? toDeposit(row) : null;
}

export async function getDepositByRequest(
	db: D1Database,
	userId: string,
	requestId: string
): Promise<Deposit | null> {
	const row = await db
		.prepare('SELECT * FROM deposits WHERE user_id = ? AND request_id = ?')
		.bind(userId, requestId)
		.first<DepositRow>();
	return row ? toDeposit(row) : null;
}

export async function getDepositByCheckingId(
	db: D1Database,
	checkingId: string
): Promise<Deposit | null> {
	const row = await db
		.prepare('SELECT * FROM deposits WHERE provider_checking_id = ?')
		.bind(checkingId)
		.first<DepositRow>();
	return row ? toDeposit(row) : null;
}

export async function getDepositByPaymentHash(
	db: D1Database,
	paymentHash: string
): Promise<Deposit | null> {
	const row = await db
		.prepare('SELECT * FROM deposits WHERE payment_hash = ?')
		.bind(paymentHash.toLowerCase())
		.first<DepositRow>();
	return row ? toDeposit(row) : null;
}

type PaymentEventType =
	| 'attempt_created'
	| 'rate_locked'
	| 'invoice_created'
	| 'provider_pending'
	| 'provider_paid'
	| 'provider_expired'
	| 'provider_failed'
	| 'provider_error'
	| 'ledger_posted';

function eventStatement(
	db: D1Database,
	depositId: string,
	type: PaymentEventType,
	data: Record<string, unknown>,
	occurredAt: number,
	deduplicationKey?: string
): D1PreparedStatement {
	return db
		.prepare(
			'INSERT INTO payment_events ' +
				'(id, deposit_id, type, deduplication_key, data, occurred_at) VALUES (?, ?, ?, ?, ?, ?) ' +
				'ON CONFLICT (deposit_id, deduplication_key) DO NOTHING'
		)
		.bind(
			crypto.randomUUID(),
			depositId,
			type,
			deduplicationKey ?? null,
			JSON.stringify(data),
			occurredAt
		);
}

export async function appendPaymentEvent(
	db: D1Database,
	depositId: string,
	type: PaymentEventType,
	data: Record<string, unknown>,
	occurredAt: number,
	deduplicationKey?: string
): Promise<void> {
	await eventStatement(db, depositId, type, data, occurredAt, deduplicationKey).run();
}

export async function createDepositIntent(
	db: D1Database,
	userId: string,
	requestId: string,
	packageId: string,
	now: number = Date.now()
): Promise<Deposit> {
	const existing = await getDepositByRequest(db, userId, requestId);
	if (existing) return existing;
	const paymentPackage = await getPackage(db, packageId);
	if (!paymentPackage) throw new Error('unknown_or_disabled_package');
	const id = crypto.randomUUID();
	try {
		const results = await db.batch<DepositRow>([
			db
				.prepare(
					'INSERT INTO deposits (' +
						'id, request_id, user_id, package_id, provider, usd_amount_cents, ' +
						'credits_awarded_units, archai_tokens_awarded_units, status, created_at, reconcile_after' +
						") VALUES (?, ?, ?, ?, 'lnbits', ?, ?, ?, 'creating', ?, ?)"
				)
				.bind(
					id,
					requestId,
					userId,
					paymentPackage.id,
					paymentPackage.usdAmountCents,
					paymentPackage.creditsAwardedUnits,
					paymentPackage.archaiTokensAwardedUnits,
					now,
					now
				),
			eventStatement(
				db,
				id,
				'attempt_created',
				{ packageId: paymentPackage.id },
				now,
				'attempt_created'
			),
			db.prepare('SELECT * FROM deposits WHERE id = ?').bind(id)
		]);
		const row = results.at(-1)?.results[0];
		if (!row) throw new Error('deposit_intent_not_persisted');
		return toDeposit(row);
	} catch (error) {
		try {
			const recovered = await getDepositByRequest(db, userId, requestId);
			if (recovered) return recovered;
		} catch (recoveryError) {
			throw new AggregateError(
				[error, recoveryError],
				'deposit intent failed and its recovery lookup also failed',
				{ cause: recoveryError }
			);
		}
		throw error;
	}
}

export async function recordDepositRate(
	db: D1Database,
	deposit: Deposit,
	satsPerUsdRate: number,
	satsAmount: number,
	now: number
): Promise<Deposit> {
	const results = await db.batch<DepositRow>([
		db
			.prepare(
				'UPDATE deposits SET sats_per_usd_rate = ?, sats_amount = ? ' +
					"WHERE id = ? AND status = 'creating' AND sats_per_usd_rate IS NULL"
			)
			.bind(satsPerUsdRate, satsAmount, deposit.id),
		eventStatement(
			db,
			deposit.id,
			'rate_locked',
			{ satsPerUsdRate, satsAmount },
			now,
			'rate_locked'
		),
		db.prepare('SELECT * FROM deposits WHERE id = ?').bind(deposit.id)
	]);
	const row = results.at(-1)?.results[0];
	if (!row || row.sats_amount === null || row.sats_per_usd_rate === null) {
		throw new Error('deposit_rate_not_persisted');
	}
	return toDeposit(row);
}

export async function claimDepositForInvoiceCreation(
	db: D1Database,
	depositId: string,
	now: number,
	leaseUntil: number = now + INVOICE_CREATION_LEASE_MS
): Promise<Deposit | null> {
	const row = await db
		.prepare(
			'UPDATE deposits SET invoice_creation_lease_until = ?, reconcile_after = ? ' +
				"WHERE id = ? AND status = 'creating' AND reconcile_after IS NOT NULL " +
				'AND reconcile_after <= ? AND (invoice_creation_lease_until IS NULL OR invoice_creation_lease_until <= ?) ' +
				'RETURNING *'
		)
		.bind(leaseUntil, leaseUntil, depositId, now, now)
		.first<DepositRow>();
	return row ? toDeposit(row) : null;
}

export async function recordDepositInvoice(
	db: D1Database,
	deposit: Deposit,
	invoice: LnbitsInvoice,
	now: number
): Promise<Deposit> {
	const expiresAt = now + INVOICE_EXPIRY_SECONDS * 1000;
	const results = await db.batch<DepositRow>([
		db
			.prepare(
				"UPDATE deposits SET provider_checking_id = ?, payment_hash = ?, bolt11 = ?, status = 'pending', " +
					'expires_at = ?, reconcile_after = ?, invoice_creation_lease_until = NULL ' +
					"WHERE id = ? AND status = 'creating' AND sats_amount = ?"
			)
			.bind(
				invoice.checkingId,
				invoice.paymentHash,
				invoice.bolt11,
				expiresAt,
				now + RECONCILIATION_INTERVAL_MS,
				deposit.id,
				invoice.satsAmount
			),
		eventStatement(
			db,
			deposit.id,
			'invoice_created',
			{ checkingId: invoice.checkingId, paymentHash: invoice.paymentHash },
			now,
			'invoice_created'
		),
		db.prepare('SELECT * FROM deposits WHERE id = ?').bind(deposit.id)
	]);
	const row = results.at(-1)?.results[0];
	if (!row || row.status !== 'pending') throw new Error('deposit_invoice_not_persisted');
	return toDeposit(row);
}

export async function recordDepositProviderError(
	db: D1Database,
	depositId: string,
	input: { operation: string; outcome: string; errorName: string },
	now: number,
	retry: boolean
): Promise<Deposit> {
	const results = await db.batch<DepositRow>([
		db
			.prepare(
				'UPDATE deposits SET reconcile_after = CASE ' +
					"WHEN ? = 1 AND status IN ('creating', 'pending') THEN ? " +
					"WHEN ? = 1 AND status = 'expired' AND expires_at + ? > ? THEN ? ELSE NULL END, " +
					'status = CASE ' +
					"WHEN ? = 0 AND status IN ('creating', 'pending') THEN 'failed' ELSE status END, " +
					"invoice_creation_lease_until = CASE WHEN status = 'creating' THEN NULL ELSE invoice_creation_lease_until END " +
					"WHERE id = ? AND status <> 'paid'"
			)
			.bind(
				retry ? 1 : 0,
				now + RECONCILIATION_INTERVAL_MS,
				retry ? 1 : 0,
				LATE_SETTLEMENT_GRACE_MS,
				now,
				now + RECONCILIATION_INTERVAL_MS,
				retry ? 1 : 0,
				depositId
			),
		eventStatement(db, depositId, 'provider_error', input, now),
		db.prepare('SELECT * FROM deposits WHERE id = ?').bind(depositId)
	]);
	const row = results.at(-1)?.results[0];
	if (!row) throw new Error('deposit_error_not_persisted');
	return toDeposit(row);
}

export async function recordDepositPending(
	db: D1Database,
	depositId: string,
	now: number
): Promise<Deposit> {
	const results = await db.batch<DepositRow>([
		db
			.prepare(
				'UPDATE deposits SET provider_checked_at = ?, reconcile_after = ? ' +
					"WHERE id = ? AND status = 'pending'"
			)
			.bind(now, now + RECONCILIATION_INTERVAL_MS, depositId),
		eventStatement(db, depositId, 'provider_pending', {}, now, 'provider_pending'),
		db.prepare('SELECT * FROM deposits WHERE id = ?').bind(depositId)
	]);
	const row = results.at(-1)?.results[0];
	if (!row) throw new Error('deposit_pending_not_persisted');
	return toDeposit(row);
}

export async function recordDepositExpired(
	db: D1Database,
	depositId: string,
	now: number
): Promise<Deposit> {
	const results = await db.batch<DepositRow>([
		db
			.prepare(
				"UPDATE deposits SET status = 'expired', provider_checked_at = ?, " +
					'reconcile_after = CASE WHEN expires_at + ? > ? THEN ? ELSE NULL END ' +
					"WHERE id = ? AND status IN ('pending', 'expired')"
			)
			.bind(now, LATE_SETTLEMENT_GRACE_MS, now, now + RECONCILIATION_INTERVAL_MS, depositId),
		eventStatement(db, depositId, 'provider_expired', {}, now, 'provider_expired'),
		db.prepare('SELECT * FROM deposits WHERE id = ?').bind(depositId)
	]);
	const row = results.at(-1)?.results[0];
	if (!row) throw new Error('deposit_expiry_not_persisted');
	return toDeposit(row);
}

export async function recordDepositFailed(
	db: D1Database,
	depositId: string,
	now: number
): Promise<Deposit> {
	const results = await db.batch<DepositRow>([
		db
			.prepare(
				"UPDATE deposits SET status = CASE WHEN status = 'expired' THEN status ELSE 'failed' END, " +
					'provider_checked_at = ?, reconcile_after = NULL, invoice_creation_lease_until = NULL ' +
					"WHERE id = ? AND status <> 'paid'"
			)
			.bind(now, depositId),
		eventStatement(db, depositId, 'provider_failed', {}, now, 'provider_failed'),
		db.prepare('SELECT * FROM deposits WHERE id = ?').bind(depositId)
	]);
	const row = results.at(-1)?.results[0];
	if (!row) throw new Error('deposit_failure_not_persisted');
	return toDeposit(row);
}

export async function recordProviderSettlement(
	db: D1Database,
	depositId: string,
	now: number
): Promise<number> {
	const results = await db.batch<{ data: string }>([
		db
			.prepare("UPDATE deposits SET reconcile_after = ? WHERE id = ? AND status <> 'paid'")
			.bind(now, depositId),
		eventStatement(db, depositId, 'provider_paid', { paidAt: now }, now, 'provider_paid'),
		db
			.prepare(
				"SELECT data FROM payment_events WHERE deposit_id = ? AND type = 'provider_paid' AND deduplication_key = 'provider_paid'"
			)
			.bind(depositId)
	]);
	const row = results.at(-1)?.results[0];
	if (!row) throw new Error('provider_settlement_not_persisted');
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.data);
	} catch {
		throw new Error('provider_settlement_event_invalid');
	}
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		typeof (parsed as Record<string, unknown>).paidAt !== 'number' ||
		!Number.isSafeInteger((parsed as Record<string, unknown>).paidAt) ||
		(parsed as Record<string, number>).paidAt <= 0
	) {
		throw new Error('provider_settlement_event_invalid');
	}
	return (parsed as Record<string, number>).paidAt;
}

export async function finalizeDeposit(
	db: D1Database,
	depositId: string,
	paidAt: number,
	now: number
): Promise<Deposit> {
	const deposit = await getDeposit(db, depositId);
	if (!deposit) throw new Error('deposit_not_found');
	if (deposit.status === 'paid') return deposit;
	if (!deposit.paymentHash || !deposit.checkingId || deposit.satsAmount === null) {
		throw new Error('deposit_invoice_missing');
	}
	const transactionId = `deposit:${deposit.id}`;
	const accountId = `app-credit:${deposit.userId}`;
	const statements: D1PreparedStatement[] = [
		db
			.prepare(
				"INSERT INTO ledger_accounts (id, asset, kind, user_id, created_at) VALUES (?, 'app_credit', 'user_balance', ?, ?) ON CONFLICT DO NOTHING"
			)
			.bind(accountId, deposit.userId, paidAt),
		db
			.prepare(
				'INSERT INTO generation_access (user_id, enabled) VALUES (?, 1) ' +
					'ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled'
			)
			.bind(deposit.userId),
		db
			.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)')
			.bind(transactionId, paidAt),
		db
			.prepare('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)')
			.bind(transactionId, accountId, deposit.creditsAwardedUnits),
		db
			.prepare('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)')
			.bind(transactionId, 'app-credit:system', -deposit.creditsAwardedUnits),
		db
			.prepare('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)')
			.bind(transactionId, 'archai-token', deposit.archaiTokensAwardedUnits),
		db
			.prepare('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)')
			.bind(transactionId, 'archai-token:system', -deposit.archaiTokensAwardedUnits),
		db.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?').bind(transactionId),
		db
			.prepare(
				"UPDATE deposits SET status = 'paid', paid_at = ?, provider_checked_at = ?, " +
					"ledger_transaction_id = ?, reconcile_after = NULL WHERE id = ? AND status <> 'paid'"
			)
			.bind(paidAt, now, transactionId, deposit.id),
		eventStatement(db, deposit.id, 'ledger_posted', { transactionId }, now, 'ledger_posted'),
		db.prepare('SELECT * FROM deposits WHERE id = ?').bind(deposit.id)
	];
	try {
		const results = await db.batch<DepositRow>(statements);
		const row = results.at(-1)?.results[0];
		if (!row || row.status !== 'paid') throw new Error('deposit_settlement_not_persisted');
		return toDeposit(row);
	} catch (error) {
		try {
			const recovered = await getDeposit(db, deposit.id);
			if (recovered?.status === 'paid') return recovered;
		} catch (recoveryError) {
			throw new AggregateError(
				[error, recoveryError],
				'deposit settlement failed and its recovery lookup also failed',
				{ cause: recoveryError }
			);
		}
		throw error;
	}
}

export async function claimDepositsForReconciliation(
	db: D1Database,
	now: number,
	leaseUntil: number,
	limit: number
): Promise<Deposit[]> {
	const { results } = await db
		.prepare(
			'UPDATE deposits SET reconcile_after = ?, invoice_creation_lease_until = ' +
				"CASE WHEN status = 'creating' THEN ? ELSE invoice_creation_lease_until END WHERE id IN (" +
				'SELECT id FROM deposits WHERE reconcile_after IS NOT NULL AND reconcile_after <= ? ' +
				"AND (status <> 'creating' OR invoice_creation_lease_until IS NULL OR invoice_creation_lease_until <= ?) " +
				"AND status IN ('creating', 'pending', 'expired') ORDER BY reconcile_after, created_at LIMIT ?" +
				') RETURNING *'
		)
		.bind(leaseUntil, leaseUntil, now, now, limit)
		.all<DepositRow>();
	return (results ?? []).map(toDeposit);
}
