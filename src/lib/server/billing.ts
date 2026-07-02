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
