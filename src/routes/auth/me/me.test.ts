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

type MeEvent = Parameters<typeof GET>[0];

function call(user: SessionUser | null, platform: App.Platform): ReturnType<typeof GET> {
	return GET({ platform, locals: { user } } as MeEvent);
}

describe('GET /auth/me — metered designer accounts', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform);
		expect(response.status).toBe(401);
	});

	it('omits credit for an account absent from METERED_DESIGNER_PUBKEYS', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, {
			env: { DB: db, METERED_DESIGNER_PUBKEYS: 'some-other-pubkey' }
		} as App.Platform);
		const result = (await response.json()) as MeResponse;
		expect(result.credit).toBeUndefined();
	});

	it('provisions and returns the starting balance on first check for a metered account', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, {
			env: { DB: db, METERED_DESIGNER_PUBKEYS: 'pubkey-1' }
		} as App.Platform);
		const result = (await response.json()) as MeResponse;
		expect(result.credit?.balance).toBe(5);
		expect(result.credit?.history).toEqual([]);
	});

	it('includes spend history for a metered account', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		db.prepare('INSERT INTO credits (user_id, balance, updated_at) VALUES (?, ?, ?)')
			.bind('user-1', 5, Date.now())
			.run();
		db.prepare(
			'INSERT INTO credit_transactions (id, user_id, amount, balance_after, kind, created_at) ' +
				'VALUES (?, ?, ?, ?, ?, ?)'
		)
			.bind('tx-1', 'user-1', 2, 3, 'render', Date.now())
			.run();

		const response = await call({ pubkey: 'pubkey-1' }, {
			env: { DB: db, METERED_DESIGNER_PUBKEYS: 'pubkey-1' }
		} as App.Platform);
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
