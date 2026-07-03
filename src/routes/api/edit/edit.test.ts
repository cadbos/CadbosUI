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

import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { DEMO_PUBKEY } from '$lib/server/demo';

// Lets a single test force recordBalance to reject, to prove a bookkeeping
// failure doesn't discard an already-successful, already-charged edit.
const billingMock = vi.hoisted(() => ({ failNextRecordBalance: false }));

vi.mock('$lib/server/billing', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/billing')>();
	return {
		...actual,
		recordBalance: vi.fn((...args: Parameters<typeof actual.recordBalance>) => {
			if (billingMock.failNextRecordBalance) {
				billingMock.failNextRecordBalance = false;
				return Promise.reject(new Error('simulated D1 failure'));
			}
			return actual.recordBalance(...args);
		})
	};
});

const { POST } = await import('./+server');

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

type EditEvent = Parameters<typeof POST>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	body: unknown
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/edit', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform,
		locals: { user }
	} as EditEvent);
}

const body = {
	image: 'https://example.test/prev-render.jpg',
	prompt: 'replace the sofa with a leather armchair'
};

describe('POST /api/edit — billing', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform, body);
		expect(response.status).toBe(401);
	});

	it('rejects an empty instruction — edit-by-prompt has no enhance fallback', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, {
			...body,
			prompt: '  '
		});
		expect(response.status).toBe(400);
	});

	it('rejects an image value that is not a URL', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, {
			...body,
			image: 'not-a-url'
		});
		expect(response.status).toBe(400);
	});

	it('chains the edit onto the previous render (Д-17: image = prior render URL)', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { outputUrl: string };
		expect(result.outputUrl).toMatch(/^https:\/\//);
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

	it('still returns the completed, already-charged edit if recording the balance fails', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		billingMock.failNextRecordBalance = true;

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);

		expect(response.status).toBe(200);
		const result = (await response.json()) as { outputUrl: string };
		expect(result.outputUrl).toMatch(/^https:\/\//);
	});

	it('never blocks editing locally — archAI is the only spend gate', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
	});

	it('rate-limits repeated edits from the same account (anti-cost-abuse, FR-К5)', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const platform = { env: { DB: db } } as App.Platform;

		const responses = [];
		for (let i = 0; i < 11; i += 1) {
			responses.push(await call({ pubkey: 'pubkey-1' }, platform, body));
		}

		expect(responses.slice(0, 10).every((response) => response.status === 200)).toBe(true);
		expect(responses[10].status).toBe(429);
	});

	it('isolates the rate limit per account', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		const platform = { env: { DB: db } } as App.Platform;

		for (let i = 0; i < 10; i += 1) {
			await call({ pubkey: 'pubkey-1' }, platform, body);
		}
		const otherAccount = await call({ pubkey: 'pubkey-2' }, platform, body);
		expect(otherAccount.status).toBe(200);
	});

	it('bypasses balance recording and rate-limiting entirely for the dev-only demo session', async () => {
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
