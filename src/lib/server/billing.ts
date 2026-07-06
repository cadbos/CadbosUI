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

// D1-backed balance cache (SRS FR-И4, NFR-18). archAI is the only source of
// truth for real funds — it already rejects a call it can't afford — so this
// module doesn't enforce anything; it just mirrors the `balance` archAI
// reports after each generation (migrations/0002_balance.sql) so the UI can
// show it without an extra round trip. Keyed by the internal D1 user id (not
// pubkey directly) to reuse the users table as designed without touching
// Module 2's SessionUser contract — one extra indexed lookup on users.pubkey
// per paid call.

import type { D1Database } from '@cloudflare/workers-types';
import type { Balance, CreditTransaction } from '$lib/api/contract';

export async function getUserIdByPubkey(db: D1Database, pubkey: string): Promise<string | null> {
	const row = await db
		.prepare('SELECT id FROM users WHERE pubkey = ?')
		.bind(pubkey)
		.first<{ id: string }>();
	return row?.id ?? null;
}

interface BalanceRow {
	balance: number;
	updated_at: number;
}

function toBalance(row: BalanceRow): Balance {
	return { balance: row.balance, updatedAt: row.updated_at };
}

// Null until the user has generated at least once — there is nothing to show
// before archAI has ever reported a balance for them.
export async function getBalance(db: D1Database, userId: string): Promise<Balance | null> {
	const row = await db
		.prepare('SELECT balance, updated_at FROM balances WHERE user_id = ?')
		.bind(userId)
		.first<BalanceRow>();
	return row ? toBalance(row) : null;
}

// Upserts the balance archAI reported. Called exactly once, only after a
// confirmed successful archAI response (never before the call, and never on
// failure) — it records what archAI said it had left after this charge, not
// a locally-computed running total.
export async function recordBalance(
	db: D1Database,
	userId: string,
	balance: number
): Promise<Balance> {
	const row = await db
		.prepare(
			'INSERT INTO balances (user_id, balance, updated_at) VALUES (?, ?, ?) ' +
				'ON CONFLICT (user_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at ' +
				'RETURNING balance, updated_at'
		)
		.bind(userId, balance, Date.now())
		.first<BalanceRow>();
	if (!row) throw new Error('balance upsert failed');
	return toBalance(row);
}

// Metered evaluation accounts (e.g. designer test accounts) — additive to the
// balance mirror above, not a replacement. A pubkey is metered only if it's
// listed in METERED_DESIGNER_PUBKEYS; every other account never gets a
// `credits` row and keeps the unlimited behavior. Pubkeys aren't secret, so
// this list travels as a plain env var — swapping test accounts is a
// redeploy, not a code change.
export function isMeteredPubkey(rawList: string | undefined, pubkey: string): boolean {
	if (!rawList) return false;
	const target = pubkey.toLowerCase();
	return rawList
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.includes(target);
}

// Fixed starting allowance for a metered account, in the same numeric unit
// archAI's own cost/balance fields use.
const METERED_STARTING_BALANCE = 5;

// Provisions the starting balance on first check, then returns the current
// one — mirrors the INSERT-OR-IGNORE-then-SELECT pattern used for users.
export async function getOrCreateCredit(db: D1Database, userId: string): Promise<Balance> {
	await db
		.prepare(
			'INSERT INTO credits (user_id, balance, updated_at) VALUES (?, ?, ?) ' +
				'ON CONFLICT (user_id) DO NOTHING'
		)
		.bind(userId, METERED_STARTING_BALANCE, Date.now())
		.run();
	const row = await db
		.prepare('SELECT balance, updated_at FROM credits WHERE user_id = ?')
		.bind(userId)
		.first<BalanceRow>();
	if (!row) throw new Error('credit provisioning failed');
	return toBalance(row);
}

export function hasSufficientCredit(credit: Balance): boolean {
	return credit.balance > 0;
}

interface CreditTransactionRow {
	amount: number;
	balance_after: number;
	kind: string;
	created_at: number;
}

function toCreditTransaction(row: CreditTransactionRow): CreditTransaction {
	return {
		amount: row.amount,
		balanceAfter: row.balance_after,
		kind: row.kind as CreditTransaction['kind'],
		createdAt: row.created_at
	};
}

// Deducts the real cost archAI charged (not a fixed fee) and logs it, so the
// account's own spend history can be shown. Called exactly once, only after a
// confirmed successful archAI response — same discipline as recordBalance.
export async function deductCredit(
	db: D1Database,
	userId: string,
	amount: number,
	kind: CreditTransaction['kind']
): Promise<Balance> {
	const row = await db
		.prepare(
			'UPDATE credits SET balance = balance - ?, updated_at = ? WHERE user_id = ? ' +
				'RETURNING balance, updated_at'
		)
		.bind(amount, Date.now(), userId)
		.first<BalanceRow>();
	if (!row) throw new Error('credit deduction failed: no credit row for user');

	await db
		.prepare(
			'INSERT INTO credit_transactions (id, user_id, amount, balance_after, kind, created_at) ' +
				'VALUES (?, ?, ?, ?, ?, ?)'
		)
		.bind(crypto.randomUUID(), userId, amount, row.balance, kind, Date.now())
		.run();

	return toBalance(row);
}

export async function listCreditHistory(
	db: D1Database,
	userId: string,
	limit = 50
): Promise<CreditTransaction[]> {
	// rowid as a tiebreaker: two deductions within the same millisecond would
	// otherwise sort arbitrarily on created_at alone.
	const { results } = await db
		.prepare(
			'SELECT amount, balance_after, kind, created_at FROM credit_transactions ' +
				'WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?'
		)
		.bind(userId, limit)
		.all<CreditTransactionRow>();
	return (results ?? []).map(toCreditTransaction);
}
