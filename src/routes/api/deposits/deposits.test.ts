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
import type { DepositResponse, SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { DEMO_PUBKEY } from '$lib/server/demo';

const lightning = vi.hoisted(() => ({
	parseNwcConnectionString: vi.fn(() => ({
		walletPubkey: 'wallet',
		relays: ['wss://relay.example.test'],
		clientSecretKey: new Uint8Array(32),
		clientPubkey: 'client'
	})),
	createInvoice: vi.fn()
}));
vi.mock('$lib/server/lightning', () => lightning);

const { POST } = await import('./+server');

type DepositsEvent = Parameters<typeof POST>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	body: unknown
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/deposits', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform,
		locals: { user }
	} as DepositsEvent);
}

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function seedPackage(db: D1Database, id: string, usdAmount: number, creditsAwarded: number): void {
	db.prepare(
		'INSERT INTO packages (id, usd_amount, credits_awarded, archai_tokens_awarded, enabled, created_at) ' +
			'VALUES (?, ?, ?, ?, 1, ?)'
	)
		.bind(id, usdAmount, creditsAwarded, creditsAwarded, Date.now())
		.run();
}

function seedRate(db: D1Database, satsPerUsd: number): void {
	const now = Date.now();
	db.prepare(
		'INSERT INTO exchange_rate_cache (provider, sats_per_usd, fetched_at, expires_at) VALUES (?, ?, ?, ?)'
	)
		.bind('kraken', satsPerUsd, now, now + 90_000)
		.run();
}

const pubkey = 'a'.repeat(64);
const withWallet = {
	NWC_CONNECTION_STRING: 'nostr+walletconnect://wallet?relay=wss%3A%2F%2Fr&secret=s'
};

describe('POST /api/deposits', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform, {
			packageId: 'pkg-1'
		});
		expect(response.status).toBe(401);
	});

	it('rejects a missing packageId', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		const response = await call({ pubkey }, { env: { DB: db, ...withWallet } } as App.Platform, {});
		expect(response.status).toBe(400);
	});

	it('blocks the dev-only demo session from real purchases', async () => {
		const response = await call({ pubkey: DEMO_PUBKEY }, { env: {} } as App.Platform, {
			packageId: 'pkg-1'
		});
		expect(response.status).toBe(403);
	});

	it('fails closed if the wallet connection string is not configured', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		seedPackage(db, 'pkg-1', 1, 3);
		seedRate(db, 2000);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, {
			packageId: 'pkg-1'
		});
		expect(response.status).toBe(500);
	});

	it('rejects an unknown package with 400, not 500', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		seedRate(db, 2000);

		const response = await call({ pubkey }, { env: { DB: db, ...withWallet } } as App.Platform, {
			packageId: 'does-not-exist'
		});
		expect(response.status).toBe(400);
		const result = (await response.json()) as { error: { code: string } };
		expect(result.error.code).toBe('invalid_package');
	});

	it('creates a deposit and returns the invoice to pay', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		seedPackage(db, 'pkg-1', 1, 3);
		seedRate(db, 2000);
		lightning.createInvoice.mockResolvedValueOnce({
			invoice: 'lnbc1...',
			paymentHash: 'hash-1',
			satsAmount: 2000,
			createdAt: 1,
			expiresAt: 601
		});

		const response = await call({ pubkey }, { env: { DB: db, ...withWallet } } as App.Platform, {
			packageId: 'pkg-1'
		});

		expect(response.status).toBe(200);
		const result = (await response.json()) as DepositResponse;
		expect(result).toMatchObject({
			status: 'pending',
			bolt11: 'lnbc1...',
			satsAmount: 2000,
			usdAmount: 1
		});
	});

	it('rate-limits repeated invoice creation from the same account', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		seedPackage(db, 'pkg-1', 1, 3);
		seedRate(db, 2000);
		lightning.createInvoice.mockResolvedValue({
			invoice: 'lnbc1...',
			paymentHash: 'hash-x',
			satsAmount: 2000,
			createdAt: 1,
			expiresAt: 601
		});
		const platform = { env: { DB: db, ...withWallet } } as App.Platform;

		const responses = [];
		for (let i = 0; i < 6; i += 1) {
			lightning.createInvoice.mockResolvedValueOnce({
				invoice: `lnbc${i}...`,
				paymentHash: `hash-${i}`,
				satsAmount: 2000,
				createdAt: 1,
				expiresAt: 601
			});
			responses.push(await call({ pubkey }, platform, { packageId: 'pkg-1' }));
		}

		expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true);
		expect(responses[5].status).toBe(429);
	});
});
