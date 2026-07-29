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
import { getExchangeRate, type ExchangeRateProvider } from '$lib/server/exchange-rate';
import { toLedgerAmountUnits } from '$lib/server/ledger-units';
import { createInvoice, type NwcConnection, type NwcRequestOptions } from '$lib/server/lightning';

const DEFAULT_DEPOSIT_EXPIRY_SECONDS = 900;
export const DEPOSIT_RECONCILIATION_INTERVAL_MS = 60_000;

export interface Package {
	id: string;
	usdAmount: number;
	creditsAwarded: number;
	archaiTokensAwarded: number;
}

interface PackageRow {
	id: string;
	usd_amount: number;
	credits_awarded: number;
	archai_tokens_awarded: number;
}

function toPackage(row: PackageRow): Package {
	return {
		id: row.id,
		usdAmount: row.usd_amount,
		creditsAwarded: row.credits_awarded,
		archaiTokensAwarded: row.archai_tokens_awarded
	};
}

export async function listPackages(db: D1Database): Promise<Package[]> {
	const { results } = await db
		.prepare(
			'SELECT id, usd_amount, credits_awarded, archai_tokens_awarded FROM packages ' +
				'WHERE enabled = 1 ORDER BY usd_amount'
		)
		.all<PackageRow>();
	return (results ?? []).map(toPackage);
}

async function getEnabledPackage(db: D1Database, packageId: string): Promise<Package | null> {
	const row = await db
		.prepare(
			'SELECT id, usd_amount, credits_awarded, archai_tokens_awarded FROM packages ' +
				'WHERE id = ? AND enabled = 1'
		)
		.bind(packageId)
		.first<PackageRow>();
	return row ? toPackage(row) : null;
}

export type DepositStatus = 'pending' | 'paid' | 'expired' | 'failed';

export interface Deposit {
	id: string;
	userId: string;
	packageId: string;
	provider: string;
	bolt11: string;
	paymentHash: string;
	satsAmount: number;
	usdAmount: number;
	satsPerUsdRate: number;
	creditsAwarded: number;
	archaiTokensAwarded: number;
	status: DepositStatus;
	createdAt: number;
	expiresAt: number;
	paidAt: number | null;
	providerCheckedAt: number | null;
	reconcileAfter: number | null;
}

interface DepositRow {
	id: string;
	user_id: string;
	package_id: string;
	provider: string;
	provider_invoice_id: string;
	payment_hash: string;
	sats_amount: number;
	usd_amount: number;
	sats_per_usd_rate: number;
	credits_awarded: number;
	archai_tokens_awarded: number;
	status: DepositStatus;
	created_at: number;
	expires_at: number;
	paid_at: number | null;
	provider_checked_at: number | null;
	reconcile_after: number | null;
}

function toDeposit(row: DepositRow): Deposit {
	return {
		id: row.id,
		userId: row.user_id,
		packageId: row.package_id,
		provider: row.provider,
		bolt11: row.provider_invoice_id,
		paymentHash: row.payment_hash,
		satsAmount: row.sats_amount,
		usdAmount: row.usd_amount,
		satsPerUsdRate: row.sats_per_usd_rate,
		creditsAwarded: row.credits_awarded,
		archaiTokensAwarded: row.archai_tokens_awarded,
		status: row.status,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		paidAt: row.paid_at,
		providerCheckedAt: row.provider_checked_at,
		reconcileAfter: row.reconcile_after
	};
}

export interface CreateDepositInput {
	packageId: string;
	rateProvider?: ExchangeRateProvider;
	expirySeconds?: number;
}

// Locks a sats amount for `input.packageId` at the current exchange rate and
// requests a Lightning invoice for it — the deposit row records everything
// needed to credit the account later without re-deriving it (rate, sats
// amount, and the credits/tokens the *package* was worth at creation time, in
// case the package catalog changes before this deposit is paid).
export async function createDeposit(
	db: D1Database,
	userId: string,
	nwc: NwcConnection,
	input: CreateDepositInput,
	options: NwcRequestOptions = {},
	now: number = Date.now()
): Promise<Deposit> {
	const pkg = await getEnabledPackage(db, input.packageId);
	if (!pkg) throw new Error(`unknown or disabled package: ${input.packageId}`);

	const rate = await getExchangeRate(db, input.rateProvider, now);
	const satsAmount = Math.ceil(pkg.usdAmount * rate.satsPerUsd);
	const expirySeconds = input.expirySeconds ?? DEFAULT_DEPOSIT_EXPIRY_SECONDS;

	const invoice = await createInvoice(
		nwc,
		satsAmount,
		`Cadbos ${pkg.id} package`,
		expirySeconds,
		options
	);

	const id = crypto.randomUUID();
	const expiresAt = now + expirySeconds * 1000;
	await db
		.prepare(
			'INSERT INTO deposits (' +
				'id, user_id, package_id, provider, provider_invoice_id, payment_hash, ' +
				'sats_amount, usd_amount, sats_per_usd_rate, credits_awarded, archai_tokens_awarded, ' +
				'status, created_at, expires_at, reconcile_after' +
				') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		)
		.bind(
			id,
			userId,
			pkg.id,
			'nwc',
			invoice.invoice,
			invoice.paymentHash,
			satsAmount,
			pkg.usdAmount,
			rate.satsPerUsd,
			pkg.creditsAwarded,
			pkg.archaiTokensAwarded,
			'pending',
			now,
			expiresAt,
			now + DEPOSIT_RECONCILIATION_INTERVAL_MS
		)
		.run();

	return {
		id,
		userId,
		packageId: pkg.id,
		provider: 'nwc',
		bolt11: invoice.invoice,
		paymentHash: invoice.paymentHash,
		satsAmount,
		usdAmount: pkg.usdAmount,
		satsPerUsdRate: rate.satsPerUsd,
		creditsAwarded: pkg.creditsAwarded,
		archaiTokensAwarded: pkg.archaiTokensAwarded,
		status: 'pending',
		createdAt: now,
		expiresAt,
		paidAt: null,
		providerCheckedAt: null,
		reconcileAfter: now + DEPOSIT_RECONCILIATION_INTERVAL_MS
	};
}

export async function getDeposit(
	db: D1Database,
	id: string,
	userId: string
): Promise<Deposit | null> {
	const row = await db
		.prepare('SELECT * FROM deposits WHERE id = ? AND user_id = ?')
		.bind(id, userId)
		.first<DepositRow>();
	return row ? toDeposit(row) : null;
}

export async function markDepositPaid(
	db: D1Database,
	paymentHash: string,
	paidAt: number = Date.now(),
	checkedAt: number = Date.now()
): Promise<Deposit | null> {
	const existing = await db
		.prepare('SELECT * FROM deposits WHERE payment_hash = ?')
		.bind(paymentHash)
		.first<DepositRow>();
	if (!existing) return null;
	if (existing.status === 'paid') return toDeposit(existing);

	const transactionId = `deposit:${existing.id}`;
	const accountId = `app-credit:${existing.user_id}`;
	const statements: D1PreparedStatement[] = [
		db
			.prepare(
				"INSERT INTO ledger_accounts (id, asset, user_id, created_at) VALUES (?, 'app_credit', ?, ?) " +
					'ON CONFLICT DO NOTHING'
			)
			.bind(accountId, existing.user_id, paidAt),
		db
			.prepare(
				'INSERT INTO generation_access (user_id, enabled) ' +
					"SELECT ?, 1 WHERE EXISTS (SELECT 1 FROM deposits WHERE payment_hash = ? AND status <> 'paid') " +
					'ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled'
			)
			.bind(existing.user_id, paymentHash),
		db
			.prepare(
				'INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?) ON CONFLICT DO NOTHING'
			)
			.bind(transactionId, paidAt),
		db
			.prepare(
				'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
					"SELECT ?, (SELECT id FROM ledger_accounts WHERE user_id = ? AND asset = 'app_credit'), ? " +
					"WHERE EXISTS (SELECT 1 FROM deposits WHERE payment_hash = ? AND status <> 'paid') " +
					'ON CONFLICT DO NOTHING'
			)
			.bind(
				transactionId,
				existing.user_id,
				toLedgerAmountUnits(existing.credits_awarded),
				paymentHash
			),
		db
			.prepare(
				"INSERT INTO ledger_entries (transaction_id, account_id, amount) SELECT ?, 'archai-token', ? " +
					"WHERE EXISTS (SELECT 1 FROM deposits WHERE payment_hash = ? AND status <> 'paid') " +
					'ON CONFLICT DO NOTHING'
			)
			.bind(transactionId, toLedgerAmountUnits(existing.archai_tokens_awarded), paymentHash),
		db
			.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ? AND finalized = 0')
			.bind(transactionId),
		db
			.prepare(
				"UPDATE deposits SET status = 'paid', paid_at = ?, ledger_transaction_id = ?, " +
					'provider_checked_at = ?, reconcile_after = NULL ' +
					"WHERE payment_hash = ? AND status <> 'paid'"
			)
			.bind(paidAt, transactionId, checkedAt, paymentHash),
		db.prepare('SELECT * FROM deposits WHERE payment_hash = ?').bind(paymentHash)
	];

	const results = await db.batch<DepositRow>(statements);
	const row = results.at(-1)?.results[0];
	if (!row || row.status !== 'paid') {
		throw new Error('Deposit paid transition failed');
	}
	return toDeposit(row);
}

export async function recordDepositInvoiceState(
	db: D1Database,
	paymentHash: string,
	status: 'pending' | 'expired' | 'failed',
	checkedAt: number,
	reconcileAfter: number | null
): Promise<Deposit | null> {
	const row = await db
		.prepare(
			'UPDATE deposits SET status = ?, provider_checked_at = ?, reconcile_after = ? ' +
				"WHERE payment_hash = ? AND status <> 'paid' RETURNING *"
		)
		.bind(status, checkedAt, reconcileAfter, paymentHash)
		.first<DepositRow>();
	if (row) return toDeposit(row);

	const existing = await db
		.prepare('SELECT * FROM deposits WHERE payment_hash = ?')
		.bind(paymentHash)
		.first<DepositRow>();
	return existing ? toDeposit(existing) : null;
}

export function depositNeedsReconciliation(deposit: Deposit): boolean {
	return (
		deposit.status === 'pending' ||
		((deposit.status === 'expired' || deposit.status === 'failed') &&
			deposit.providerCheckedAt === null)
	);
}

export async function claimDepositsForReconciliation(
	db: D1Database,
	now: number,
	leaseUntil: number,
	limit: number
): Promise<Deposit[]> {
	const { results } = await db
		.prepare(
			'UPDATE deposits SET reconcile_after = ? WHERE id IN (' +
				'SELECT id FROM deposits WHERE reconcile_after IS NOT NULL AND reconcile_after <= ? ' +
				"AND (status = 'pending' OR (status IN ('expired', 'failed') AND provider_checked_at IS NULL)) " +
				'ORDER BY reconcile_after, created_at LIMIT ?' +
				') RETURNING *'
		)
		.bind(leaseUntil, now, limit)
		.all<DepositRow>();
	return (results ?? []).map(toDeposit);
}
