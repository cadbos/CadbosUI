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
import type { MeResponse, SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { GET } from './+server';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

// The admin's manual approval step (migrations/0005) — no auto-provisioning
// exists anymore.
function grantAccess(db: D1Database, userId: string, balance: number, enabled: 0 | 1 = 1): void {
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, ?)')
		.bind(userId, balance, Date.now(), enabled)
		.run();
}

type MeEvent = Parameters<typeof GET>[0];

function call(user: SessionUser | null, platform: App.Platform): ReturnType<typeof GET> {
	return GET({ platform, locals: { user } } as MeEvent);
}

const pubkey = 'a'.repeat(64);

describe('GET /auth/me — generation access control', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform);
		expect(response.status).toBe(401);
	});

	it('omits credit for an account no admin has approved', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform);
		const result = (await response.json()) as MeResponse;
		expect(result.credit).toBeUndefined();
	});

	it('returns the admin-chosen balance for an approved account', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantAccess(db, 'user-1', 12);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform);
		const result = (await response.json()) as MeResponse;
		expect(result.credit?.balance).toBe(12);
		expect(result.credit?.history).toEqual([]);
	});

	it('still shows balance/history for an account the admin has since disabled', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantAccess(db, 'user-1', 12, 0);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform);
		const result = (await response.json()) as MeResponse;
		expect(result.credit?.balance).toBe(12);
	});

	it('includes spend history for an approved account', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantAccess(db, 'user-1', 5);
		db.prepare(
			'INSERT INTO generations ' +
				'(id, user_id, url, source_url, prompt, kind, amount, balance_after, created_at) ' +
				"VALUES (?, ?, 'https://cdn.example.test/out.webp', 'https://cdn.example.test/room.jpg', " +
				"'cozy', ?, ?, ?, ?)"
		)
			.bind('tx-1', 'user-1', 'render', 2, 3, Date.now())
			.run();

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform);
		const result = (await response.json()) as MeResponse;
		expect(result.credit?.history).toEqual([
			expect.objectContaining({ amount: 2, balanceAfter: 3, kind: 'render' })
		]);
	});

	it('bypasses D1 entirely for the dev-only demo session', async () => {
		const response = await call({ pubkey: DEMO_PUBKEY }, { env: {} } as App.Platform);
		expect(response.status).toBe(200);
		const result = (await response.json()) as MeResponse;
		expect(result.credit).toBeUndefined();
	});
});
