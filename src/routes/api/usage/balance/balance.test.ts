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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser, WalletBalanceResponse } from '$lib/api/contract';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { GET } from './+server';

const getWalletBalance = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/wallet', () => ({ getWalletBalance }));

const ADMIN_PUBKEY = 'admin-pubkey';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, 1000)
		.run();
}

type BalanceEvent = Parameters<typeof GET>[0];

function call(user: SessionUser | null, platform: App.Platform): ReturnType<typeof GET> {
	return GET({ platform, locals: { user } } as BalanceEvent);
}

function platform(db: D1Database, adminPubkeys = ADMIN_PUBKEY): App.Platform {
	return { env: { DB: db, ADMIN_PUBKEYS: adminPubkeys } } as App.Platform;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GET /api/usage/balance', () => {
	it('returns 401 for non-authenticated users', async () => {
		const response = await call(null, platform(makeD1()));

		expect(response.status).toBe(401);
	});

	it('returns 403 for authenticated non-admin users', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, platform(db));

		expect(response.status).toBe(403);
	});

	it('fails closed for the dev-only demo session without touching D1', async () => {
		const response = await call({ pubkey: DEMO_PUBKEY }, {
			env: { ADMIN_PUBKEYS: DEMO_PUBKEY }
		} as App.Platform);
		const result = await response.json();

		expect(response.status).toBe(500);
		expect(result).toEqual({
			error: { code: 'account_error', message: 'Account record not found' }
		});
		expect(getWalletBalance).not.toHaveBeenCalled();
	});

	it('returns the live wallet balance for an admin', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY);
		getWalletBalance.mockResolvedValue(123.45);

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db));
		const result = (await response.json()) as WalletBalanceResponse;

		expect(response.status).toBe(200);
		expect(result).toEqual({ balance: 123.45 });
	});

	it('returns 502 when the live balance check fails', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY);
		getWalletBalance.mockRejectedValue(new Error('archAI unreachable'));

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db));
		const result = await response.json();

		expect(response.status).toBe(502);
		expect(result).toEqual({
			error: { code: 'wallet_balance_unavailable', message: 'Could not retrieve wallet balance' }
		});
	});
});
