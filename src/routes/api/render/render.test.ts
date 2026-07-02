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
import type { SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { POST } from './+server';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

type RenderEvent = Parameters<typeof POST>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	body: unknown
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/render', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform,
		locals: { user }
	} as RenderEvent);
}

const body = { image: 'https://example.test/room.jpg', prompt: 'cozy', outputFormat: 'webp' };

describe('POST /api/render — billing', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform, body);
		expect(response.status).toBe(401);
	});

	it('records the real balance archAI reports on a successful call', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { balance: number };

		const balanceRow = await db
			.prepare('SELECT balance FROM balances WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(balanceRow?.balance).toBe(result.balance);
	});

	it('overwrites the stored balance rather than accumulating it across calls', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		const second = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		const result = (await second.json()) as { balance: number };

		const balanceRow = await db
			.prepare('SELECT balance FROM balances WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(balanceRow?.balance).toBe(result.balance);
	});

	it('never blocks generation locally — archAI is the only spend gate', async () => {
		// No local quota table to seed at all; a brand-new user with no prior
		// balance record must still be able to generate.
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
	});

	it('bypasses balance recording entirely for the dev-only demo session', async () => {
		// No D1 binding at all — proves the demo path never touches billing.
		const response = await call({ pubkey: DEMO_PUBKEY }, { env: {} } as App.Platform, body);
		expect(response.status).toBe(200);
	});

	it('fails closed if a real session has no matching D1 user row', async () => {
		const db = makeD1();
		const response = await call(
			{ pubkey: 'ghost-pubkey' },
			{ env: { DB: db } } as App.Platform,
			body
		);
		expect(response.status).toBe(500);
	});
});
