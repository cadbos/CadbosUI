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

import type { D1Database } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '$lib/api/contract';
import { DEMO_PUBKEY } from '$lib/server/demo';
import type { Deposit } from '$lib/server/payments';
import { makeD1 } from '$lib/server/testing/d1-shim';

const reconciliation = vi.hoisted(() => ({ createOrResumeDeposit: vi.fn() }));
vi.mock('$lib/server/deposit-reconciliation', () => reconciliation);

const { POST } = await import('./+server');
type DepositsEvent = Parameters<typeof POST>[0];

function seedUser(db: D1Database, pubkey = 'pubkey-1'): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', pubkey, Date.now())
		.run();
}

function platform(db: D1Database, configured = true): App.Platform {
	return {
		env: {
			DB: db,
			...(configured
				? {
						LNBITS_BASE_URL: 'https://lnbits.example.test',
						LNBITS_INVOICE_KEY: 'invoice-key'
					}
				: {})
		}
	} as App.Platform;
}

function call(
	user: SessionUser | null,
	db: D1Database,
	body: unknown,
	configured = true
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/deposits', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		platform: platform(db, configured),
		locals: { user }
	} as DepositsEvent);
}

function deposit(status: Deposit['status'] = 'pending'): Deposit {
	return {
		id: crypto.randomUUID(),
		requestId: crypto.randomUUID(),
		userId: 'user-1',
		packageId: 'pkg-1',
		checkingId: status === 'creating' ? null : 'checking-1',
		paymentHash: status === 'creating' ? null : 'a'.repeat(64),
		bolt11: status === 'creating' ? null : 'lnbc1test',
		satsAmount: status === 'creating' ? null : 1_200,
		usdAmount: 1,
		satsPerUsdRate: status === 'creating' ? null : 1_200,
		creditsAwardedUnits: 300,
		archaiTokensAwardedUnits: 300,
		status,
		createdAt: Date.now(),
		expiresAt: status === 'creating' ? null : Date.now() + 900_000,
		paidAt: null,
		providerCheckedAt: null,
		reconcileAfter: Date.now() + 60_000,
		invoiceCreationLeaseUntil: status === 'creating' ? Date.now() + 180_000 : null,
		ledgerTransactionId: null
	};
}

beforeEach(() => {
	reconciliation.createOrResumeDeposit.mockReset();
});

describe('POST /api/deposits', () => {
	it('enforces authentication, validation, and demo restrictions', async () => {
		const db = makeD1();

		expect((await call(null, db, {})).status).toBe(401);
		expect((await call({ pubkey: 'pubkey-1' }, db, {})).status).toBe(400);
		expect(
			(
				await call({ pubkey: DEMO_PUBKEY }, db, {
					requestId: crypto.randomUUID(),
					packageId: 'pkg-1'
				})
			).status
		).toBe(403);
		expect(reconciliation.createOrResumeDeposit).not.toHaveBeenCalled();
	});

	it('fails closed when LNbits is not configured', async () => {
		const db = makeD1();
		seedUser(db);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await call(
			{ pubkey: 'pubkey-1' },
			db,
			{ requestId: crypto.randomUUID(), packageId: 'pkg-1' },
			false
		);

		expect(response.status).toBe(502);
		expect(reconciliation.createOrResumeDeposit).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledOnce();
		consoleError.mockRestore();
	});

	it('returns 202 with the same browser contract when creation is lease-contended', async () => {
		const db = makeD1();
		seedUser(db);
		const creating = deposit('creating');
		reconciliation.createOrResumeDeposit.mockResolvedValueOnce(creating);

		const response = await call({ pubkey: 'pubkey-1' }, db, {
			requestId: creating.requestId,
			packageId: 'pkg-1'
		});
		const result = await response.json();

		expect(response.status).toBe(202);
		expect(response.headers.get('location')).toBe(`/api/deposits/${creating.id}`);
		expect(result).toEqual({ id: creating.id, status: 'creating', usdAmount: 1 });
	});

	it('maps unknown packages and rate-limits provider work', async () => {
		const db = makeD1();
		seedUser(db);
		reconciliation.createOrResumeDeposit.mockRejectedValueOnce(
			new Error('unknown_or_disabled_package')
		);
		const invalid = await call({ pubkey: 'pubkey-1' }, db, {
			requestId: crypto.randomUUID(),
			packageId: 'missing'
		});
		expect(invalid.status).toBe(400);

		reconciliation.createOrResumeDeposit.mockResolvedValue(deposit());
		const responses: Response[] = [];
		for (let index = 0; index < 5; index += 1) {
			responses.push(
				await call({ pubkey: 'pubkey-1' }, db, {
					requestId: crypto.randomUUID(),
					packageId: 'pkg-1'
				})
			);
		}

		expect(responses.slice(0, 4).every((response) => response.status === 201)).toBe(true);
		expect(responses[4].status).toBe(429);
	});
});
