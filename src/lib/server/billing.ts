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
// reports after each generation (migrations/0002_balance.sql) for ops
// visibility (query the `balances` table directly) — this is the one shared
// ARCHAI_API_KEY account's balance, never a given user's own, so it's
// intentionally never read back out to the client. Keyed by the internal D1
// user id (not pubkey directly) to reuse the users table as designed without
// touching Module 2's SessionUser contract — one extra indexed lookup on
// users.pubkey per paid call.

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

// Generation access control (security requirement, not a billing nicety): by
// default nobody can render/edit — an account can only generate once an admin
// manually inserts a `credits` row for it (via `wrangler d1 execute`, keyed by
// the internal user id — see the workflow note in migrations/0004). The
// `enabled` flag lets the admin revoke access without losing the row's
// balance/history; `balance` is whatever limit the admin chose for that
// account, not a fixed constant.
export interface CreditAccess extends Balance {
	enabled: boolean;
}

interface CreditRow {
	balance: number;
	updated_at: number;
	enabled: number;
}

function toCreditAccess(row: CreditRow): CreditAccess {
	return { balance: row.balance, updatedAt: row.updated_at, enabled: row.enabled === 1 };
}

// Null when no admin has approved this account yet — the caller must treat
// that as "not allowed to generate", not "unlimited".
export async function getCredit(db: D1Database, userId: string): Promise<CreditAccess | null> {
	const row = await db
		.prepare('SELECT balance, updated_at, enabled FROM credits WHERE user_id = ?')
		.bind(userId)
		.first<CreditRow>();
	return row ? toCreditAccess(row) : null;
}

// Whether the account is allowed to attempt generation at all, independent of
// remaining balance — false for both "never approved" (no row) and "approved
// but disabled by the admin".
export function hasGenerationAccess(credit: CreditAccess | null): credit is CreditAccess {
	return credit?.enabled === true;
}

export function hasSufficientCredit(credit: CreditAccess): boolean {
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
//
// The balance check in the route happens before the (slow) archAI call, not
// atomically with this deduction — two concurrent requests for the same
// account can each pass that check and both land here, taking balance below
// zero. Left unguarded on purpose: the ledger must reflect what archAI
// actually charged, so silently refusing to record a real, already-paid
// deduction here would make the spend history wrong. For a small number of
// manually-approved accounts this is an accepted soft cap, not a hard one.
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
