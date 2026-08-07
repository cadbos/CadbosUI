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

import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '$lib/api/contract';
import {
	claimDepositForInvoiceCreation,
	createDepositIntent,
	finalizeDeposit,
	recordDepositInvoice,
	recordDepositRate,
	recordProviderSettlement,
	type Deposit
} from '$lib/server/payments';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { GET } from './+server';

const NOW = 1_800_000_000_000;
const PAYMENT_HASH = 'a'.repeat(64);
type DepositStatusEvent = Parameters<typeof GET>[0];

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, NOW)
		.run();
}

function vpcService(fetchImpl: typeof fetch): Fetcher {
	return { fetch: fetchImpl } as unknown as Fetcher;
}

function platform(
	db: D1Database,
	configured = true,
	fetchImpl: typeof fetch = vi.fn()
): App.Platform {
	return {
		env: {
			DB: db,
			...(configured
				? {
						LNBITS_VPC: vpcService(fetchImpl),
						LNBITS_INVOICE_KEY: 'invoice-key'
					}
				: {})
		}
	} as App.Platform;
}

function call(
	user: SessionUser | null,
	db: D1Database,
	id: string,
	configured = true,
	fetchImpl: typeof fetch = vi.fn()
): ReturnType<typeof GET> {
	return GET({
		params: { id },
		platform: platform(db, configured, fetchImpl),
		locals: { user }
	} as DepositStatusEvent);
}

async function pendingDeposit(db: D1Database, userId: string): Promise<Deposit> {
	const intent = await createDepositIntent(db, userId, crypto.randomUUID(), 'pkg-1', NOW);
	const rated = await recordDepositRate(db, intent, 1_200, 1_200, NOW + 1);
	return recordDepositInvoice(
		db,
		rated,
		{
			checkingId: 'checking-1',
			paymentHash: PAYMENT_HASH,
			bolt11: 'lnbc12u1test',
			satsAmount: 1_200
		},
		NOW + 2
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('GET /api/deposits/[id]', () => {
	it('returns the generic not-found response without querying for an invalid deposit ID', async () => {
		const db = makeD1();
		const prepare = vi.spyOn(db, 'prepare');

		const response = await call({ pubkey: 'pubkey-1' }, db, 'not-a-uuid');

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { code: 'deposit_not_found', message: 'Payment attempt not found' }
		});
		expect(prepare).not.toHaveBeenCalled();
	});

	it('authorizes ownership before consuming the status rate limit', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		const pending = await pendingDeposit(db, 'user-1');

		expect((await call(null, db, pending.id)).status).toBe(401);
		expect((await call({ pubkey: 'pubkey-2' }, db, pending.id)).status).toBe(404);
		expect(
			await db
				.prepare(
					"SELECT COUNT(*) AS count FROM rate_limits WHERE bucket = 'deposit-status:pubkey-2'"
				)
				.first()
		).toEqual({ count: 0 });
	});

	it('returns a paid deposit without LNbits configuration or polling limits', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const pending = await pendingDeposit(db, 'user-1');
		const paidAt = await recordProviderSettlement(db, pending.id, NOW + 10);
		const paid = await finalizeDeposit(db, pending.id, paidAt, NOW + 11);

		const response = await call({ pubkey: 'pubkey-1' }, db, paid.id, false);
		const result = await response.json();

		expect(response.status).toBe(200);
		expect(result).toMatchObject({ id: paid.id, status: 'paid', balance: 3 });
		expect(
			await db
				.prepare(
					"SELECT COUNT(*) AS count FROM rate_limits WHERE bucket = 'deposit-status:pubkey-1'"
				)
				.first()
		).toEqual({ count: 0 });
	});

	it('returns a lease-contended creating attempt as 202 without requiring configuration', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const intent = await createDepositIntent(
			db,
			'user-1',
			crypto.randomUUID(),
			'pkg-1',
			Date.now()
		);
		await claimDepositForInvoiceCreation(db, intent.id, Date.now());

		const response = await call({ pubkey: 'pubkey-1' }, db, intent.id, false);
		const result = await response.json();

		expect(response.status).toBe(202);
		expect(result).toMatchObject({ id: intent.id, status: 'creating' });
		expect(
			await db
				.prepare(
					"SELECT COUNT(*) AS count FROM rate_limits WHERE bucket = 'deposit-status:pubkey-1'"
				)
				.first()
		).toEqual({ count: 0 });
	});

	it('surfaces transient provider failures so the client can back off', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const pending = await pendingDeposit(db, 'user-1');
		const request = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await call({ pubkey: 'pubkey-1' }, db, pending.id, true, request);

		expect(response.status).toBe(502);
		expect(consoleError).toHaveBeenCalledWith('Payment status reconciliation failed:', {
			errorName: 'LnbitsError'
		});
		consoleError.mockRestore();
	});
});
