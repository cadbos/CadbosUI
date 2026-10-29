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

import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser, UsageTotals } from '$lib/api/contract';
import { createDb } from '$lib/server/db';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { seedCredit } from '$lib/server/testing/ledger-fixtures';
import { seedGeneration } from '$lib/server/testing/generation-fixtures';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { seedAdmin } from '$lib/server/testing/session-fixtures';
import { GET } from './+server';

const ADMIN_PUBKEY = 'admin-pubkey';

async function seedUser(db: D1Database, id: string, pubkey: string): Promise<void> {
	await db
		.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, 1000)
		.run();
}

type TotalsEvent = Parameters<typeof GET>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	search = ''
): ReturnType<typeof GET> {
	return GET({
		url: new URL(`https://cadbos.example/api/usage/totals${search}`),
		platform,
		locals: { sessionLookupUnavailable: false, user }
	} as TotalsEvent);
}

function platform(db: D1Database): App.Platform {
	return { env: { DB: db } } as App.Platform;
}

describe('GET /api/usage/totals', () => {
	it('returns 401 for non-authenticated users', async () => {
		const response = await call(null, platform(makeD1()));

		expect(response.status).toBe(401);
	});

	it('returns 403 for authenticated non-admin users', async () => {
		const db = makeD1();
		await seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: 'pubkey-1' }, platform(db));

		expect(response.status).toBe(403);
	});

	it('fails closed for the dev-only demo session without touching D1', async () => {
		const response = await call({ pubkey: DEMO_PUBKEY }, { env: {} } as App.Platform);
		const result = await response.json();

		expect(response.status).toBe(500);
		expect(result).toEqual({
			error: { code: 'account_error', message: 'Account record not found' }
		});
	});

	it('returns 403 when the session has no user record', async () => {
		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(makeD1()));

		expect(response.status).toBe(403);
	});

	it('returns platform-wide totals for an admin', async () => {
		const db = makeD1();
		await seedUser(db, 'admin', ADMIN_PUBKEY);
		await seedAdmin(db, 'admin');
		await seedUser(db, 'user-1', 'pubkey-1');

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db));
		const result = (await response.json()) as UsageTotals;

		expect(response.status).toBe(200);
		expect(result).toEqual({
			userCount: 2,
			projectCount: 0,
			sessionCount: 0,
			generationCount: 0,
			sourceCount: 0,
			sourceBytes: null,
			referenceCount: 0,
			referenceBytes: null,
			totalSpend: 0,
			totalDeposit: 0
		});
	});

	it('limits every total to the range', async () => {
		const db = makeD1();
		await seedUser(db, 'admin', ADMIN_PUBKEY);
		await seedAdmin(db, 'admin');
		await db
			.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
			.bind('user-1', 'pubkey-1', 5000)
			.run();
		await seedCredit(createDb(db), 'user-1', 11.5, 1, 5000);
		for (const [id, amount, createdAt, balanceAfter] of [
			['generation-1', 1.25, 5000, 10.25],
			['generation-2', 2.75, 9000, 7.5]
		] as const) {
			await seedGeneration(createDb(db), {
				id,
				userId: 'user-1',
				url: `https://cdn.example.test/${id}.webp`,
				sourceUrl: 'https://cdn.example.test/source.jpg',
				sourceChecksum: '1'.repeat(64),
				amount,
				balanceAfter,
				createdAt
			});
		}

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db), '?from=4000&to=6000');

		expect(response.status).toBe(200);
		expect((await response.json()) as UsageTotals).toEqual({
			userCount: 1,
			projectCount: 0,
			sessionCount: 0,
			generationCount: 1,
			sourceCount: 1,
			sourceBytes: null,
			referenceCount: 0,
			referenceBytes: null,
			totalSpend: 1.25,
			totalDeposit: 11.5
		});
	});

	it('rejects an incomplete range', async () => {
		const db = makeD1();
		await seedUser(db, 'admin', ADMIN_PUBKEY);
		await seedAdmin(db, 'admin');

		const response = await call({ pubkey: ADMIN_PUBKEY }, platform(db), '?from=4000');

		expect(response.status).toBe(400);
	});
});
