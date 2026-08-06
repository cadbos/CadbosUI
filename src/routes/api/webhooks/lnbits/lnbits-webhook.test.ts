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
import { getCredit } from '$lib/server/billing';
import {
	createDepositIntent,
	getDeposit,
	recordDepositInvoice,
	recordDepositRate,
	type Deposit
} from '$lib/server/payments';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { POST } from './+server';

const NOW = 1_800_000_000_000;
const PAYMENT_HASH = 'a'.repeat(64);
type WebhookEvent = Parameters<typeof POST>[0];

async function pendingDeposit(db: D1Database): Promise<Deposit> {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', NOW)
		.run();
	const intent = await createDepositIntent(db, 'user-1', crypto.randomUUID(), 'pkg-1', NOW);
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

function vpcService(fetchImpl: typeof fetch): Fetcher {
	return { fetch: fetchImpl } as unknown as Fetcher;
}

function call(
	db: D1Database,
	body: unknown,
	fetchImpl: typeof fetch = vi.fn()
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/webhooks/lnbits', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform: {
			env: {
				DB: db,
				LNBITS_VPC: vpcService(fetchImpl),
				LNBITS_INVOICE_KEY: 'invoice-key'
			}
		},
		getClientAddress: () => '192.0.2.1'
	} as WebhookEvent);
}

function statusResponse(paymentHash = PAYMENT_HASH): Response {
	return Response.json({
		paid: true,
		details: {
			checking_id: 'checking-1',
			payment_hash: paymentHash,
			amount: 1_200_000,
			status: 'success'
		}
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('POST /api/webhooks/lnbits', () => {
	it('treats malformed and unknown callbacks as accepted wake-up signals', async () => {
		const db = makeD1();

		expect((await call(db, { arbitrary: true })).status).toBe(202);
		expect((await call(db, { checking_id: 'unknown' })).status).toBe(202);
	});

	it('credits only after an authenticated LNbits lookup verifies the stored identity', async () => {
		const db = makeD1();
		const pending = await pendingDeposit(db);
		const request = vi.fn().mockResolvedValue(statusResponse());

		const response = await call(db, { checking_id: pending.checkingId, paid: true }, request);

		expect(response.status).toBe(202);
		expect(request).toHaveBeenCalledWith(
			new URL(`http://localhost:5000/api/v1/payments/${PAYMENT_HASH}`),
			expect.objectContaining({ headers: expect.objectContaining({ 'X-Api-Key': 'invoice-key' }) })
		);
		await expect(getDeposit(db, pending.id)).resolves.toMatchObject({ status: 'paid' });
		await expect(getCredit(db, 'user-1')).resolves.toMatchObject({ balance: 3 });
	});

	it('never credits a callback whose provider lookup returns a different identity', async () => {
		const db = makeD1();
		const pending = await pendingDeposit(db);
		const request = vi.fn().mockResolvedValue(statusResponse('b'.repeat(64)));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await call(db, { payment_hash: PAYMENT_HASH }, request);

		expect(response.status).toBe(202);
		await expect(getDeposit(db, pending.id)).resolves.toMatchObject({ status: 'failed' });
		await expect(getCredit(db, 'user-1')).resolves.toBeNull();
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
