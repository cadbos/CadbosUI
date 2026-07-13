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

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { DepositResponse, SessionUser } from '$lib/api/contract';
import { grantGenerationAccess, makeD1 } from '$lib/server/testing/d1-shim';

const lightning = vi.hoisted(() => ({
	parseNwcConnectionString: vi.fn(() => ({
		walletPubkey: 'wallet',
		relays: ['wss://relay.example.test'],
		clientSecretKey: new Uint8Array(32),
		clientPubkey: 'client'
	})),
	lookupInvoice: vi.fn()
}));
vi.mock('$lib/server/lightning', () => lightning);

const { GET } = await import('./+server');

afterEach(() => {
	lightning.parseNwcConnectionString.mockClear();
	lightning.lookupInvoice.mockClear();
});

type DepositStatusEvent = Parameters<typeof GET>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	id: string
): ReturnType<typeof GET> {
	return GET({ platform, locals: { user }, params: { id } } as DepositStatusEvent);
}

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function seedDeposit(
	db: D1Database,
	id: string,
	userId: string,
	overrides: { status?: string; createdAt?: number; expiresAt?: number } = {}
): { paymentHash: string } {
	const now = overrides.createdAt ?? Date.now();
	const paymentHash = `hash-${id}`;
	db.prepare(
		'INSERT INTO packages (id, usd_amount, credits_awarded, archai_tokens_awarded, enabled, created_at) ' +
			"VALUES ('pkg-1', 1, 3, 3, 1, ?)"
	)
		.bind(now)
		.run();
	db.prepare(
		'INSERT INTO deposits (' +
			'id, user_id, package_id, provider, provider_invoice_id, payment_hash, sats_amount, ' +
			'usd_amount, sats_per_usd_rate, credits_awarded, archai_tokens_awarded, status, created_at, expires_at' +
			') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	)
		.bind(
			id,
			userId,
			'pkg-1',
			'nwc',
			'lnbc1...',
			paymentHash,
			2000,
			1,
			2000,
			3,
			3,
			overrides.status ?? 'pending',
			now,
			overrides.expiresAt ?? now + 600_000
		)
		.run();
	return { paymentHash };
}

const pubkey = 'a'.repeat(64);
const withWallet = {
	NWC_CONNECTION_STRING: 'nostr+walletconnect://wallet?relay=wss%3A%2F%2Fr&secret=s'
};

describe('GET /api/deposits/[id]', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform, 'deposit-1');
		expect(response.status).toBe(401);
	});

	it('returns 404 for a deposit that does not belong to the caller', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		seedUser(db, 'user-2', 'b'.repeat(64));
		seedDeposit(db, 'deposit-1', 'user-1');

		const response = await call(
			{ pubkey: 'b'.repeat(64) },
			{ env: { DB: db, ...withWallet } } as App.Platform,
			'deposit-1'
		);
		expect(response.status).toBe(404);
	});

	it('stays pending when the wallet reports the invoice unpaid', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		seedDeposit(db, 'deposit-1', 'user-1');
		lightning.lookupInvoice.mockResolvedValueOnce({
			state: 'pending',
			paymentHash: 'hash-deposit-1',
			settledAt: null
		});

		const response = await call(
			{ pubkey },
			{ env: { DB: db, ...withWallet } } as App.Platform,
			'deposit-1'
		);

		expect(response.status).toBe(200);
		const result = (await response.json()) as DepositResponse;
		expect(result.status).toBe('pending');
		expect(result.balance).toBeUndefined();
	});

	it('credits the account and returns the fresh balance once the wallet reports settled', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 0);
		seedDeposit(db, 'deposit-1', 'user-1');
		lightning.lookupInvoice.mockResolvedValueOnce({
			state: 'settled',
			paymentHash: 'hash-deposit-1',
			settledAt: 12345
		});

		const response = await call(
			{ pubkey },
			{ env: { DB: db, ...withWallet } } as App.Platform,
			'deposit-1'
		);

		expect(response.status).toBe(200);
		const result = (await response.json()) as DepositResponse;
		expect(result.status).toBe('paid');
		expect(result.balance).toBe(3);
	});

	it('does not double-credit on a second poll after settlement', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 0);
		seedDeposit(db, 'deposit-1', 'user-1');
		lightning.lookupInvoice.mockResolvedValue({
			state: 'settled',
			paymentHash: 'hash-deposit-1',
			settledAt: 12345
		});
		const platform = { env: { DB: db, ...withWallet } } as App.Platform;

		await call({ pubkey }, platform, 'deposit-1');
		const second = await call({ pubkey }, platform, 'deposit-1');

		expect(second.status).toBe(200);
		const result = (await second.json()) as DepositResponse;
		expect(result.status).toBe('paid');
		expect(result.balance).toBe(3);
	});

	it('expires an overdue pending deposit without calling the wallet', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		seedDeposit(db, 'deposit-1', 'user-1', {
			createdAt: Date.now() - 2000,
			expiresAt: Date.now() - 1000
		});

		const response = await call(
			{ pubkey },
			{ env: { DB: db, ...withWallet } } as App.Platform,
			'deposit-1'
		);

		expect(response.status).toBe(200);
		const result = (await response.json()) as DepositResponse;
		expect(result.status).toBe('expired');
		expect(lightning.lookupInvoice).not.toHaveBeenCalled();
	});
});
