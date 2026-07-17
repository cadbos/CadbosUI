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
import { toLedgerAmountUnits } from '$lib/server/ledger-units';
import { grantGenerationAccess, makeD1 } from '$lib/server/testing/d1-shim';
import { DEMO_PUBKEY } from '$lib/server/demo';

const generationsMock = vi.hoisted(() => ({ failFinalization: false }));

vi.mock('$lib/server/generations', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/generations')>();
	return {
		...actual,
		finalizeGenerationOperation: vi.fn(
			(...args: Parameters<typeof actual.finalizeGenerationOperation>) => {
				if (generationsMock.failFinalization) {
					return Promise.reject(new Error('simulated D1 failure'));
				}
				return actual.finalizeGenerationOperation(...args);
			}
		)
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

	it('renders an exterior image and returns a URL', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 12);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { outputUrl: string };
		expect(result.outputUrl).toMatch(/^https:\/\//);
	});

	it('debits the global token ledger without exposing the provider balance', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 12);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { balance: number; cost: number };

		const balanceRow = await db
			.prepare(
				'SELECT balance.balance FROM ledger_accounts account ' +
					'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
					"WHERE account.asset = 'archai_token' AND account.user_id IS NULL"
			)
			.first<{ balance: number }>();
		expect(balanceRow?.balance).toBe(-toLedgerAmountUnits(result.cost));
		expect(result.balance).toBe(12 - result.cost);
	});

	it('records the generated exterior image, source and prompt against the authenticated profile', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 12);

		const response = await call({ pubkey: 'pubkey-1' }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { outputUrl: string };

		const row = await db
			.prepare(
				'SELECT generation.user_id, detail.output_url AS url, detail.input_url AS source_url, ' +
					'generation.prompt, generation.kind FROM generations generation ' +
					'JOIN image_generation_details detail ON detail.generation_id = generation.id ' +
					'WHERE generation.user_id = ?'
			)
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

	it('returns 500 and retains a confirmed operation when finalization keeps failing', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 12);
		generationsMock.failFinalization = true;
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			const response = await call(
				{ pubkey: 'pubkey-1' },
				{ env: { DB: db } } as App.Platform,
				body
			);

			expect(response.status).toBe(500);
			expect(consoleError).toHaveBeenCalledWith(
				'exterior render operation failed:',
				expect.any(Error)
			);
			expect(
				db
					.prepare('SELECT status FROM generation_operations WHERE user_id = ?')
					.bind('user-1')
					.first<{ status: string }>()
			).toEqual({ status: 'confirmed' });
		} finally {
			generationsMock.failFinalization = false;
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
		it('blocks an account with no generation access', async () => {
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
			grantGenerationAccess(db, 'user-1', 5, 0);

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(403);
			const result = (await response.json()) as { error: { code: string } };
			expect(result.error.code).toBe('generation_restricted');
		});

		it('allows and deducts the real archAI cost for an approved, enabled account', async () => {
			const db = makeD1();
			seedUser(db, 'user-1', pubkey);
			grantGenerationAccess(db, 'user-1', 12);

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(200);
			const result = (await response.json()) as { cost: number };

			const creditRow = await db
				.prepare(
					'SELECT balance.balance FROM ledger_accounts account ' +
						'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
						"WHERE account.user_id = ? AND account.asset = 'app_credit'"
				)
				.bind('user-1')
				.first<{ balance: number }>();
			expect(creditRow?.balance).toBe(toLedgerAmountUnits(12 - result.cost));
		});

		it('blocks generation once an approved account exhausts its balance', async () => {
			const db = makeD1();
			seedUser(db, 'user-1', pubkey);
			grantGenerationAccess(db, 'user-1', 0);

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(402);
			const result = (await response.json()) as { error: { code: string } };
			expect(result.error.code).toBe('insufficient_credit');
		});

		it('returns a clean 500 instead of crashing if the ledger schema is missing', async () => {
			const db = makeD1();
			seedUser(db, 'user-1', pubkey);
			db.prepare('DROP TABLE generation_access').run();

			const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
			expect(response.status).toBe(500);
		});
	});
});
