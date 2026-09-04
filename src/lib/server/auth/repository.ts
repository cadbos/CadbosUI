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

// D1-backed storage for auth (SRS Appendix B.8). Identity is the Nostr pubkey; no
// passwords or private keys are ever stored. All timestamps are epoch milliseconds.

import { sql } from 'drizzle-orm';
import type { SessionUser } from '$lib/api/contract';
import type { Database } from '$lib/server/db';
import { randomToken } from './session';

interface UserRow {
	id: string;
	pubkey: string;
	first_name: string | null;
	last_name: string | null;
}

export async function createChallenge(
	db: Database,
	nonce: string,
	pubkey: string,
	createdAt: number
): Promise<void> {
	await db.run(
		sql`INSERT INTO auth_challenges (nonce, pubkey, created_at) VALUES (${nonce}, ${pubkey}, ${createdAt})`
	);
}

// Atomically consume a challenge: succeeds only if the nonce was issued to this
// pubkey, is unused, and is still within its TTL. The single UPDATE makes replay
// impossible even under concurrent verifies (second caller gets 0 changes).
export async function consumeChallenge(
	db: Database,
	nonce: string,
	pubkey: string,
	minCreatedAt: number,
	now: number
): Promise<boolean> {
	const result = await db.run(
		sql`UPDATE auth_challenges SET used_at = ${now}
			WHERE nonce = ${nonce} AND pubkey = ${pubkey} AND used_at IS NULL AND created_at >= ${minCreatedAt}`
	);
	return result.meta.changes === 1;
}

// Find the user for a pubkey, creating one on first sight (sign-up == first verify).
export async function findOrCreateUser(
	db: Database,
	pubkey: string,
	now: number
): Promise<UserRow> {
	await db.run(
		sql`INSERT OR IGNORE INTO users (id, pubkey, created_at) VALUES (${randomToken()}, ${pubkey}, ${now})`
	);
	const user = await db.get<UserRow>(
		sql`SELECT id, pubkey, first_name, last_name FROM users WHERE pubkey = ${pubkey}`
	);
	if (!user) throw new Error('user upsert failed');
	return user;
}

export async function createSession(
	db: Database,
	id: string,
	userId: string,
	createdAt: number,
	expiresAt: number,
	userAgent: string | null
): Promise<void> {
	await db.run(
		sql`INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent)
			VALUES (${id}, ${userId}, ${createdAt}, ${expiresAt}, ${userAgent})`
	);
}

export async function findValidSession(
	db: Database,
	id: string,
	now: number
): Promise<SessionUser | null> {
	const row = await db.get<Pick<UserRow, 'pubkey' | 'first_name' | 'last_name'>>(
		sql`SELECT u.pubkey, u.first_name, u.last_name FROM sessions s
			JOIN users u ON u.id = s.user_id WHERE s.id = ${id} AND s.expires_at > ${now}`
	);
	if (!row) return null;
	return {
		pubkey: row.pubkey,
		...(row.first_name ? { firstName: row.first_name } : {}),
		...(row.last_name ? { lastName: row.last_name } : {})
	};
}

export async function deleteSession(db: Database, id: string): Promise<void> {
	await db.run(sql`DELETE FROM sessions WHERE id = ${id}`);
}

export async function updateUserProfile(
	db: Database,
	pubkey: string,
	firstName: string | null | undefined,
	lastName: string | null | undefined
): Promise<SessionUser> {
	const existing = await db.get<Pick<UserRow, 'first_name' | 'last_name'>>(
		sql`SELECT first_name, last_name FROM users WHERE pubkey = ${pubkey}`
	);
	if (!existing) throw new Error('user profile update failed');
	const firstNameValue = firstName === undefined ? existing.first_name : firstName;
	const lastNameValue = lastName === undefined ? existing.last_name : lastName;
	await db.run(
		sql`UPDATE users SET first_name = ${firstNameValue}, last_name = ${lastNameValue} WHERE pubkey = ${pubkey}`
	);
	const row = await db.get<Pick<UserRow, 'pubkey' | 'first_name' | 'last_name'>>(
		sql`SELECT pubkey, first_name, last_name FROM users WHERE pubkey = ${pubkey}`
	);
	if (!row) throw new Error('user profile update failed');
	return {
		pubkey: row.pubkey,
		...(row.first_name ? { firstName: row.first_name } : {}),
		...(row.last_name ? { lastName: row.last_name } : {})
	};
}
