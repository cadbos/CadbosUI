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

// Lets a single test force recordGeneration and/or the getCredit fallback to
// reject, to prove the response never falls back to archAI's raw (shared) balance.
const billingMock = vi.hoisted(() => ({
	failNextRecordBalance: false,
	failNextGetCredit: false
}));
const generationsMock = vi.hoisted(() => ({ failNextRecordGeneration: false }));

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
		}),
		getCredit: vi.fn((...args: Parameters<typeof actual.getCredit>) => {
			if (billingMock.failNextGetCredit) {
				billingMock.failNextGetCredit = false;
				return Promise.reject(new Error('simulated D1 failure'));
			}
			return actual.getCredit(...args);
		})
	};
});

vi.mock('$lib/server/generations', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/generations')>();
	return {
		...actual,
		recordGeneration: vi.fn((...args: Parameters<typeof actual.recordGeneration>) => {
			if (generationsMock.failNextRecordGeneration) {
				generationsMock.failNextRecordGeneration = false;
				return Promise.reject(new Error('simulated D1 failure'));
			}
			return actual.recordGeneration(...args);
		})
	};
});

const { POST } = await import('./+server');

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

// The admin's manual approval step (migrations/0005) — no auto-provisioning
// exists anymore, so every test that expects a render to succeed must grant
// access first.
function grantAccess(db: D1Database, userId: string, balance: number, enabled: 0 | 1 = 1): void {
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, ?)')
		.bind(userId, balance, Date.now(), enabled)
		.run();
}

type ExteriorRenderEvent = Parameters<typeof POST>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	body: unknown
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/render/exterior', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform,
		locals: { user }
	} as ExteriorRenderEvent);
}

const body = {
	image: 'https://example.test/facade.jpg',
	prompt: 'modern facade with warm evening lights',
	outputFormat: 'webp'
};
const pubkey = 'a'.repeat(64);

describe('POST /api/render/exterior — billing', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform, body);
		expect(response.status).toBe(401);
	});

	it('mirrors the real archAI balance server-side without ever exposing it to the client', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantAccess(db, 'user-1', 12);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { balance: number; cost: number };

		// The archAI mock reports balance 48 — that must land in the ops-only
		// mirror, never in the response the client sees.
		const balanceRow = await db
			.prepare('SELECT balance FROM balances WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(balanceRow?.balance).toBe(48);
		expect(result.balance).toBe(12 - result.cost);
	});

	it('records the generated image, source and prompt against the authenticated profile', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 12);

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { outputUrl: string };

		const row = await db
			.prepare('SELECT user_id, url, source_url, prompt, kind FROM generations WHERE user_id = ?')
			.bind('user-1')
			.first<{ user_id: string; url: string; source_url: string; prompt: string; kind: string }>();
		expect(row).toEqual({
			user_id: 'user-1',
			url: result.outputUrl,
			source_url: body.image,
			prompt: body.prompt,
			kind: 'render'
		});
	});

	it('still returns the completed, already-charged render if recordGeneration fails', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 12);
		generationsMock.failNextRecordGeneration = true;
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			const response = await call(
				{ pubkey: 'pubkey-1' },
				{ env: { DB: db } } as App.Platform,
				body
			);

			expect(response.status).toBe(200);
			const result = (await response.json()) as { outputUrl: string };
			expect(result.outputUrl).toMatch(/^https:\/\//);
			expect(consoleError).toHaveBeenCalledWith(
				'recordGeneration failed after a successful exterior render:',
				expect.any(Error)
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it('still returns the completed, already-charged render if recording the balance fails', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 12);
		billingMock.failNextRecordBalance = true;
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			const response = await call(
				{ pubkey: 'pubkey-1' },
				{ env: { DB: db } } as App.Platform,
				body
			);

			expect(response.status).toBe(200);
			const result = (await response.json()) as { outputUrl: string };
			expect(result.outputUrl).toMatch(/^https:\/\//);
			expect(consoleError).toHaveBeenCalledWith(
				'recordBalance failed after a successful exterior render:',
				expect.any(Error)
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it('never falls back to the raw archAI balance if recordGeneration and the getCredit fallback both fail', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantAccess(db, 'user-1', 12);
		generationsMock.failNextRecordGeneration = true;
		billingMock.failNextGetCredit = true;

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { balance: number };

		// The archAI mock reports balance 48 (the shared account) — even with every
		// approved-account balance read failing, the client must never see it.
		expect(result.balance).not.toBe(48);
		expect(result.balance).toBe(12);
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

	describe('generation access control', () => {
		it('blocks an account with no credits row at all', async () => {
			const db = makeD1();
			seedUser(db, 'user-1', pubkey);

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(403);
			const result = (await response.json()) as { error: { code: string } };
			expect(result.error.code).toBe('generation_restricted');
		});

		it('blocks an account the admin disabled, even with balance remaining', async () => {
			const db = makeD1();
			seedUser(db, 'user-1', pubkey);
			grantAccess(db, 'user-1', 5, 0);

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(403);
			const result = (await response.json()) as { error: { code: string } };
			expect(result.error.code).toBe('generation_restricted');
		});

		it('allows and deducts the real archAI cost for an approved, enabled account', async () => {
			const db = makeD1();
			seedUser(db, 'user-1', pubkey);
			grantAccess(db, 'user-1', 12);

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(200);
			const result = (await response.json()) as { cost: number };

			const creditRow = await db
				.prepare('SELECT balance FROM credits WHERE user_id = ?')
				.bind('user-1')
				.first<{ balance: number }>();
			expect(creditRow?.balance).toBe(12 - result.cost);
		});

		it('blocks generation once an approved account exhausts its balance', async () => {
			const db = makeD1();
			seedUser(db, 'user-1', pubkey);
			grantAccess(db, 'user-1', 0);

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(402);
			const result = (await response.json()) as { error: { code: string } };
			expect(result.error.code).toBe('insufficient_credit');
		});
	});
});
