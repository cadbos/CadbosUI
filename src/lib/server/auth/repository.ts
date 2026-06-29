// D1-backed storage for auth (SRS Appendix B.8). Identity is the Nostr pubkey; no
// passwords or private keys are ever stored. All timestamps are epoch milliseconds.

import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser } from '$lib/api/contract';
import { randomToken } from './session';

interface UserRow {
	id: string;
	pubkey: string;
	first_name: string | null;
	last_name: string | null;
}

// Resolve the D1 binding from the request platform. Missing binding is a server
// misconfiguration, surfaced as a generic 500 (never reached on public pages).
export function getDb(platform: App.Platform | undefined): D1Database {
	const db = platform?.env?.DB;
	if (!db) throw new Error('D1 binding "DB" is not available');
	return db;
}

export async function createChallenge(
	db: D1Database,
	nonce: string,
	pubkey: string,
	createdAt: number
): Promise<void> {
	await db
		.prepare('INSERT INTO auth_challenges (nonce, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(nonce, pubkey, createdAt)
		.run();
}

// Atomically consume a challenge: succeeds only if the nonce was issued to this
// pubkey, is unused, and is still within its TTL. The single UPDATE makes replay
// impossible even under concurrent verifies (second caller gets 0 changes).
export async function consumeChallenge(
	db: D1Database,
	nonce: string,
	pubkey: string,
	minCreatedAt: number,
	now: number
): Promise<boolean> {
	const result = await db
		.prepare(
			'UPDATE auth_challenges SET used_at = ? ' +
				'WHERE nonce = ? AND pubkey = ? AND used_at IS NULL AND created_at >= ?'
		)
		.bind(now, nonce, pubkey, minCreatedAt)
		.run();
	return result.meta.changes === 1;
}

// Find the user for a pubkey, creating one on first sight (sign-up == first verify).
export async function findOrCreateUser(
	db: D1Database,
	pubkey: string,
	now: number
): Promise<UserRow> {
	await db
		.prepare('INSERT OR IGNORE INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(randomToken(), pubkey, now)
		.run();
	const user = await db
		.prepare('SELECT id, pubkey, first_name, last_name FROM users WHERE pubkey = ?')
		.bind(pubkey)
		.first<UserRow>();
	if (!user) throw new Error('user upsert failed');
	return user;
}

export async function createSession(
	db: D1Database,
	id: string,
	userId: string,
	createdAt: number,
	expiresAt: number,
	userAgent: string | null
): Promise<void> {
	await db
		.prepare(
			'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'
		)
		.bind(id, userId, createdAt, expiresAt, userAgent)
		.run();
}

export async function findValidSession(
	db: D1Database,
	id: string,
	now: number
): Promise<SessionUser | null> {
	const row = await db
		.prepare(
			'SELECT u.pubkey, u.first_name, u.last_name FROM sessions s ' +
				'JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?'
		)
		.bind(id, now)
		.first<Pick<UserRow, 'pubkey' | 'first_name' | 'last_name'>>();
	if (!row) return null;
	return {
		pubkey: row.pubkey,
		...(row.first_name ? { firstName: row.first_name } : {}),
		...(row.last_name ? { lastName: row.last_name } : {})
	};
}

export async function deleteSession(db: D1Database, id: string): Promise<void> {
	await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}
