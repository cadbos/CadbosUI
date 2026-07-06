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

const billingMock = vi.hoisted(() => ({ failNextRecordBalance: false }));
const generatedImagesMock = vi.hoisted(() => ({ failNextRecordGeneratedImage: false }));

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

vi.mock('$lib/server/generated-images', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/generated-images')>();
	return {
		...actual,
		recordGeneratedImage: vi.fn((...args: Parameters<typeof actual.recordGeneratedImage>) => {
			if (generatedImagesMock.failNextRecordGeneratedImage) {
				generatedImagesMock.failNextRecordGeneratedImage = false;
				return Promise.reject(new Error('simulated generated image record failure'));
			}
			return actual.recordGeneratedImage(...args);
		})
	};
});

const { POST } = await import('./+server');

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

// The admin's manual approval step (migrations/0004) — no auto-provisioning
// exists anymore, so every test that expects a render to succeed must grant
// access first.
function grantAccess(db: D1Database, userId: string, balance: number, enabled: 0 | 1 = 1): void {
	db.prepare('INSERT INTO credits (user_id, balance, updated_at, enabled) VALUES (?, ?, ?, ?)')
		.bind(userId, balance, Date.now(), enabled)
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
const pubkey = 'a'.repeat(64);

describe('POST /api/render — billing', () => {
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

	it('records the generated image against the authenticated profile', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 12);

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { outputUrl: string };

		const imageRow = await db
			.prepare('SELECT user_id, url FROM generated_images WHERE user_id = ?')
			.bind('user-1')
			.first<{ user_id: string; url: string }>();
		expect(imageRow).toEqual({ user_id: 'user-1', url: result.outputUrl });
	});

	it('overwrites the mirrored archAI balance rather than accumulating it across calls', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantAccess(db, 'user-1', 12);

		await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		await call({ pubkey }, { env: { DB: db } } as App.Platform, body);

		const balanceRow = await db
			.prepare('SELECT balance FROM balances WHERE user_id = ?')
			.bind('user-1')
			.first<{ balance: number }>();
		expect(balanceRow?.balance).toBe(48);
	});

	it('still returns the completed, already-charged render if recording the image fails', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		grantAccess(db, 'user-1', 12);
		generatedImagesMock.failNextRecordGeneratedImage = true;
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
				'recordGeneratedImage failed after a successful render:',
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
				'recordBalance/deductCredit failed after a successful render:',
				expect.any(Error)
			);
		} finally {
			consoleError.mockRestore();
		}
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

		it('returns a clean 500 instead of crashing if the credits table is missing (unapplied migration)', async () => {
			const db = makeD1();
			seedUser(db, 'user-1', pubkey);
			db.prepare('DROP TABLE credits').run();

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(500);
		});
	});
});
