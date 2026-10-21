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

import { afterEach, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { seedAdmin } from '$lib/server/testing/session-fixtures';
import { GET } from './+server';

type Event = Parameters<typeof GET>[0];

const TODAY = new Date().toISOString().slice(0, 10);

function call(user: SessionUser | null, db: D1Database): ReturnType<typeof GET> {
	return GET({
		platform: { env: { DB: db } } as App.Platform,
		locals: { sessionLookupUnavailable: false, user }
	} as Event);
}

async function seedAdminUser(db: D1Database): Promise<void> {
	await db
		.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('admin', 'admin-pubkey', 1000)
		.run();
	await seedAdmin(db, 'admin');
}

afterEach(() => {
	vi.restoreAllMocks();
});

it('requires an authenticated admin', async () => {
	const db = makeD1();

	expect((await call(null, db)).status).toBe(401);
	expect((await call({ pubkey: 'user' }, db)).status).toBe(403);
});

it("returns today's recorded Workers AI usage and the free allocation to an admin", async () => {
	const db = makeD1();
	await seedAdminUser(db);
	await db
		.prepare('INSERT INTO workers_ai_daily_usage (date, requests, neurons) VALUES (?, ?, ?)')
		.bind(TODAY, 42, 37.5)
		.run();
	await db
		.prepare('INSERT INTO workers_ai_daily_usage (date, requests, neurons) VALUES (?, ?, ?)')
		.bind('2000-01-01', 9, 9_999)
		.run();

	const response = await call({ pubkey: 'admin-pubkey' }, db);

	expect(response.status).toBe(200);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(await response.json()).toEqual({
		date: TODAY,
		requests: 42,
		neurons: 37.5,
		neuronLimit: 10_000
	});
});

it('surfaces a storage failure without exposing its details', async () => {
	const db = makeD1();
	await seedAdminUser(db);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	await db.prepare('DROP TABLE workers_ai_daily_usage').run();

	const response = await call({ pubkey: 'admin-pubkey' }, db);

	expect(response.status).toBe(503);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(await response.json()).toEqual({
		error: { code: 'workers_ai_usage_unavailable', message: 'Could not retrieve Workers AI usage' }
	});
});
