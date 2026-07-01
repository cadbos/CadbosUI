// D1-backed billing/quota storage (SRS FR-И4, NFR-18). The `quotas` table itself
// is scaffolded in migrations/0001_auth.sql (Module 2); this module owns the
// charging/limit logic against it. Quota is keyed by the internal D1 user id
// (not pubkey directly) to reuse the table as designed without touching Module 2's
// SessionUser contract — one extra indexed lookup on users.pubkey per paid call.

import type { D1Database } from '@cloudflare/workers-types';
import type { Quota } from '$lib/api/contract';

// MVP simplification: a single lifetime allowance, no periodic reset. The SRS
// doesn't specify a reset cadence (Д-10-style defensive default); `period` is
// carried through the wire type for forward compatibility only.
const DEFAULT_QUOTA_LIMIT = 50;
const DEFAULT_QUOTA_PERIOD = 'lifetime';

export async function getUserIdByPubkey(db: D1Database, pubkey: string): Promise<string | null> {
	const row = await db
		.prepare('SELECT id FROM users WHERE pubkey = ?')
		.bind(pubkey)
		.first<{ id: string }>();
	return row?.id ?? null;
}

interface QuotaRow {
	balance_or_limit: number;
	usage: number;
	period: string;
}

function toQuota(row: QuotaRow): Quota {
	return { balanceOrLimit: row.balance_or_limit, usage: row.usage, period: row.period };
}

// Find-or-create, mirroring auth/repository.ts's findOrCreateUser pattern: an
// INSERT OR IGNORE makes first-touch provisioning idempotent under concurrency.
export async function getOrCreateQuota(db: D1Database, userId: string): Promise<Quota> {
	await db
		.prepare(
			'INSERT OR IGNORE INTO quotas (user_id, balance_or_limit, usage, period) VALUES (?, ?, 0, ?)'
		)
		.bind(userId, DEFAULT_QUOTA_LIMIT, DEFAULT_QUOTA_PERIOD)
		.run();
	const row = await db
		.prepare('SELECT balance_or_limit, usage, period FROM quotas WHERE user_id = ?')
		.bind(userId)
		.first<QuotaRow>();
	if (!row) throw new Error('quota upsert failed');
	return toQuota(row);
}

export function hasQuota(quota: Quota): boolean {
	return quota.usage < quota.balanceOrLimit;
}

// Deducts `cost` atomically and returns the resulting quota. Called exactly once,
// only after a confirmed successful archAI response (never before the call, and
// never on failure) — deduction is the record of a cost already incurred, not a
// reservation.
export async function deductQuota(db: D1Database, userId: string, cost: number): Promise<Quota> {
	const row = await db
		.prepare(
			'UPDATE quotas SET usage = usage + ? WHERE user_id = ? ' +
				'RETURNING balance_or_limit, usage, period'
		)
		.bind(cost, userId)
		.first<QuotaRow>();
	if (!row) throw new Error('quota deduction failed: no quota row for user');
	return toQuota(row);
}
