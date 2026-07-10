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

import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser, UserUsageResponse } from '$lib/api/contract';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { toLedgerAmountUnits } from '$lib/server/ledger-units';
import { grantGenerationAccess, makeD1, seedGeneratedImage } from '$lib/server/testing/d1-shim';
import { GET } from './+server';

const ADMIN_PUBKEY = 'admin-pubkey';

function seedUser(db: D1Database, id: string, pubkey: string, createdAt: number): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, createdAt)
		.run();
}

function seedGeneration(
	db: D1Database,
	id: string,
	userId: string,
	amount: number,
	createdAt: number
): void {
	const transactionId = `generation:${id}`;
	db.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)')
		.bind(transactionId, createdAt)
		.run();
	db.prepare(
		'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
			"SELECT ?, id, ? FROM ledger_accounts WHERE user_id = ? AND asset = 'app_credit'"
	)
		.bind(transactionId, -toLedgerAmountUnits(amount), userId)
		.run();
	db.prepare(
		'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
			"VALUES (?, (SELECT id FROM ledger_accounts WHERE user_id IS NULL AND asset = 'archai_token'), ?)"
	)
		.bind(transactionId, -toLedgerAmountUnits(amount))
		.run();
	db.prepare(
		'INSERT INTO generations ' +
			'(id, user_id, prompt, kind, ledger_transaction_id, created_at) ' +
			"VALUES (?, ?, 'cozy', 'render', ?, ?)"
	)
		.bind(id, userId, transactionId, createdAt)
		.run();
	db.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?').bind(transactionId).run();
}

function seedDeposit(
	db: D1Database,
	id: string,
	userId: string,
	creditsAwarded: number,
	createdAt: number,
	status: 'pending' | 'paid'
): void {
	const packageId = `package:${id}`;
	const transactionId = `deposit:${id}`;
	db.prepare(
		'INSERT INTO packages ' +
			'(id, usd_amount, credits_awarded, archai_tokens_awarded, enabled, created_at) ' +
			'VALUES (?, 10, ?, 100, 1, ?)'
	)
		.bind(packageId, creditsAwarded, createdAt)
		.run();
	if (status === 'paid') {
		db.prepare('INSERT INTO ledger_transactions (id, occurred_at) VALUES (?, ?)')
			.bind(transactionId, createdAt)
			.run();
		db.prepare(
			'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
				"VALUES (?, (SELECT id FROM ledger_accounts WHERE user_id = ? AND asset = 'app_credit'), ?)"
		)
			.bind(transactionId, userId, toLedgerAmountUnits(creditsAwarded))
			.run();
		db.prepare(
			'INSERT INTO ledger_entries (transaction_id, account_id, amount) ' +
				"VALUES (?, (SELECT id FROM ledger_accounts WHERE user_id IS NULL AND asset = 'archai_token'), ?)"
		)
			.bind(transactionId, toLedgerAmountUnits(100))
			.run();
		db.prepare('UPDATE ledger_transactions SET finalized = 1 WHERE id = ?')
			.bind(transactionId)
			.run();
	}
	db.prepare(
		'INSERT INTO deposits ' +
			'(id, user_id, package_id, provider, provider_invoice_id, payment_hash, sats_amount, ' +
			'usd_amount, sats_per_usd_rate, credits_awarded, archai_tokens_awarded, status, ' +
			'created_at, expires_at, paid_at, ledger_transaction_id) ' +
			'VALUES (?, ?, ?, ?, ?, ?, 1000, 10, 100, ?, 100, ?, ?, ?, ?, ?)'
	)
		.bind(
			id,
			userId,
			packageId,
			'test',
			`invoice:${id}`,
			`hash:${id}`,
			creditsAwarded,
			status,
			createdAt,
			createdAt + 60_000,
			status === 'paid' ? createdAt : null,
			status === 'paid' ? transactionId : null
		)
		.run();
}

type UsageEvent = Parameters<typeof GET>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	search = ''
): ReturnType<typeof GET> {
	return GET({
		url: new URL(`https://cadbos.example/api/usage${search}`),
		platform,
		locals: { user }
	} as UsageEvent);
}

function platform(db: D1Database, adminPubkeys = ADMIN_PUBKEY): App.Platform {
	return { env: { DB: db, ADMIN_PUBKEYS: adminPubkeys } } as App.Platform;
}

describe('GET /api/usage', () => {
	it('returns 401 for non-authenticated users', async () => {
		const response = await call(null, platform(makeD1()));
		const result = await response.json();

		expect(response.status).toBe(401);
		expect(result).toEqual({
			error: {
				code: 'unauthorized',
				message: 'Authentication required'
			}
		});
	});

	it('returns 403 for authenticated non-admin users', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1', 1000);

		const response = await call({ pubkey: 'pubkey-1' }, platform(db));
		const result = await response.json();

		expect(response.status).toBe(403);
		expect(result).toEqual({
			error: {
				code: 'forbidden',
				message: 'Admin access required'
			}
		});
	});

	it('rejects unknown search params', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY, 1000);

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db), '?userId=user-1');

		expect(response.status).toBe(400);
	});

	it('rejects invalid pagination params', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY, 1000);

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db), '?offset=-1&size=0');

		expect(response.status).toBe(400);
	});

	it('uses default pagination params', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY, 10_000);
		for (let index = 0; index < 20; index += 1) {
			seedUser(db, `user-${index}`, `pubkey-${index}`, 1000 + index);
		}

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db));
		const result = (await response.json()) as UserUsageResponse;

		expect(response.status).toBe(200);
		expect(result.users).toHaveLength(20);
		expect(result.users[0]?.pubkey).toBe(ADMIN_PUBKEY);
		expect(result.pagination).toEqual({ offset: 0, size: 20, hasMore: true });
	});

	it('applies offset and size search params', async () => {
		const db = makeD1();
		seedUser(db, 'oldest', 'oldest-pubkey', 1000);
		seedUser(db, 'middle', 'middle-pubkey', 2000);
		seedUser(db, 'admin', ADMIN_PUBKEY, 3000);

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db), '?offset=1&size=2');
		const result = (await response.json()) as UserUsageResponse;

		expect(response.status).toBe(200);
		expect(result.users.map((user) => user.pubkey)).toEqual(['middle-pubkey', 'oldest-pubkey']);
		expect(result.pagination).toEqual({ offset: 1, size: 2, hasMore: false });
	});

	it('returns all-user usage aggregates', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY, 3000);
		seedUser(db, 'user-1', 'pubkey-1', 2000);
		seedUser(db, 'user-2', 'pubkey-2', 1000);
		grantGenerationAccess(db, 'user-1', 8.5, 1, 4000);
		seedDeposit(db, 'deposit-1', 'user-1', 3, 4500, 'paid');
		seedDeposit(db, 'deposit-2', 'user-1', 99, 4700, 'pending');
		seedGeneration(db, 'generation-1', 'user-1', 1.25, 5000);
		seedGeneration(db, 'generation-2', 'user-1', 2.75, 6000);
		seedGeneratedImage(db, 'generation-free', 'user-1', 7000);
		grantGenerationAccess(db, 'user-2', 1.5, 1, 5000);
		seedGeneration(db, 'generation-3', 'user-2', 1.5, 5500);

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db), '?size=10');
		const result = (await response.json()) as UserUsageResponse;

		expect(response.status).toBe(200);
		expect(result.users).toEqual([
			{
				pubkey: ADMIN_PUBKEY,
				balance: 0,
				totalDeposit: 0,
				lastDepositAt: null,
				generationCount: 0,
				totalSpend: 0,
				latestSpendAt: null
			},
			{
				pubkey: 'pubkey-1',
				balance: 7.5,
				totalDeposit: 3,
				lastDepositAt: 4500,
				generationCount: 3,
				totalSpend: 4,
				latestSpendAt: 6000
			},
			{
				pubkey: 'pubkey-2',
				balance: 0,
				totalDeposit: 0,
				lastDepositAt: null,
				generationCount: 1,
				totalSpend: 1.5,
				latestSpendAt: 5500
			}
		]);
	});

	it('accepts comma-separated admin pubkeys with whitespace', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY, 1000);

		const response = await call(
			{ pubkey: ADMIN_PUBKEY },
			platform(db, `other-pubkey, ${ADMIN_PUBKEY}`)
		);

		expect(response.status).toBe(200);
	});

	it('fails closed for the dev-only demo session without touching D1', async () => {
		const response = await call({ pubkey: DEMO_PUBKEY }, {
			env: { ADMIN_PUBKEYS: DEMO_PUBKEY }
		} as App.Platform);
		const result = await response.json();

		expect(response.status).toBe(500);
		expect(result).toEqual({
			error: {
				code: 'account_error',
				message: 'Account record not found'
			}
		});
	});

	it('fails closed if a real session has no matching D1 user row', async () => {
		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(makeD1()));

		expect(response.status).toBe(500);
	});
});
