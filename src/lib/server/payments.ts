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

// Lightning-deposit purchase flow (docs/payments-lightning-sats.md §5-7), on top
// of the ledger schema from migrations/0007. Mirrors the shape of
// generations.ts's recordGeneration(): a fixed rate/invoice is locked at
// createDeposit time, and markDepositPaid() is the only place credits_awarded /
// archai_tokens_awarded ever become real ledger entries — in the same atomic D1
// batch as the deposit's own status transition.

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { getExchangeRate, type ExchangeRateProvider } from '$lib/server/exchange-rate';
import { toLedgerAmountUnits } from '$lib/server/ledger-units';
import { createInvoice, type NwcConnection, type NwcRequestOptions } from '$lib/server/lightning';

// Placeholder pending the client's final answer on deposit lifetime
// (docs/payments-lightning-sats.md §10.3) — override via CreateDepositInput
// once that's confirmed instead of editing this constant in multiple places.
const DEFAULT_DEPOSIT_EXPIRY_SECONDS = 900;

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
		paidAt: row.paid_at
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
				'status, created_at, expires_at' +
				') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
			expiresAt
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
		paidAt: null
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

// Called by the deposit-status poll route once lightning.ts's lookupInvoice
// reports the invoice settled — there is no NWC webhook (see lightning.ts).
// Idempotent: a deposit already 'paid' is returned as-is without crediting
// twice; one already 'expired'/'failed' is left alone (returns null) rather
// than resurrected. The credit is one atomic D1 batch, the same shape
// generations.ts's recordGeneration() uses for the opposite (debiting) case —
// both entries are positive here, crediting the user's app_credit account and
// the shared archai_token pool it draws down from on each generation.
export async function markDepositPaid(
	db: D1Database,
	paymentHash: string,
	now: number = Date.now()
): Promise<Deposit | null> {
	const existing = await db
		.prepare('SELECT * FROM deposits WHERE payment_hash = ?')
		.bind(paymentHash)
		.first<DepositRow>();
	if (!existing) return null;
	if (existing.status === 'paid') return toDeposit(existing);
	if (existing.status !== 'pending') return null;

	const transactionId = `deposit:${existing.id}`;
	const statements: D1PreparedStatement[] = [
		db
			.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)')
			.bind(transactionId, now),
		db
			.prepare(
				'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
					"VALUES (?, (SELECT id FROM ledger_accounts WHERE user_id = ? AND asset = 'app_credit'), ?)"
			)
			.bind(transactionId, existing.user_id, toLedgerAmountUnits(existing.credits_awarded)),
		db
			.prepare(
				"INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, 'archai-token', ?)"
			)
			.bind(transactionId, toLedgerAmountUnits(existing.archai_tokens_awarded)),
		db
			.prepare(
				"UPDATE deposits SET status = 'paid', paid_at = ?, ledger_transaction_id = ? " +
					"WHERE payment_hash = ? AND status = 'pending'"
			)
			.bind(now, transactionId, paymentHash),
		db.prepare('SELECT * FROM deposits WHERE payment_hash = ?').bind(paymentHash)
	];

	const results = await db.batch<DepositRow>(statements);
	const row = results.at(-1)?.results[0];
	if (!row || row.status !== 'paid') {
		throw new Error(`deposit paid transition failed for payment_hash ${paymentHash}`);
	}
	return toDeposit(row);
}

export async function expireStaleDeposits(
	db: D1Database,
	now: number = Date.now()
): Promise<number> {
	const result = await db
		.prepare("UPDATE deposits SET status = 'expired' WHERE status = 'pending' AND expires_at < ?")
		.bind(now)
		.run();
	return result.meta.changes;
}
