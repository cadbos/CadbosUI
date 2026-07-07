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
import type { Balance } from '$lib/api/contract';

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
// the internal user id — see the workflow note in migrations/0005). The
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

// Shared by /api/render and /api/edit (both gate generation the same way):
// resolves whether an account may attempt a paid call at all, independent of
// the route-specific error response each caller wants to send back. Returns
// the pre-call balance on success so callers don't need a second getCredit
// round-trip to get it.
export type GenerationCheck =
	| { allowed: true; balance: number }
	| { allowed: false; reason: 'not_approved' | 'insufficient_credit' };

export async function assertGenerationAllowed(
	db: D1Database,
	userId: string
): Promise<GenerationCheck> {
	const credit = await getCredit(db, userId);
	if (!hasGenerationAccess(credit)) return { allowed: false, reason: 'not_approved' };
	if (!hasSufficientCredit(credit)) return { allowed: false, reason: 'insufficient_credit' };
	return { allowed: true, balance: credit.balance };
}
