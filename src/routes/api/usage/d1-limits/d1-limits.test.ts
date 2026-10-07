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

function platform(db: D1Database): App.Platform {
	return {
		env: {
			DB: db,
			CLOUDFLARE_ACCOUNT_ID: 'account-id',
			CLOUDFLARE_ANALYTICS_API_TOKEN: 'analytics-token'
		}
	} as App.Platform;
}

function call(
	user: SessionUser | null,
	app: App.Platform,
	fetcher: typeof fetch
): ReturnType<typeof GET> {
	return GET({
		platform: app,
		locals: { sessionLookupUnavailable: false, user },
		fetch: fetcher
	} as Event);
}

afterEach(() => {
	vi.restoreAllMocks();
});

it('requires an authenticated admin before querying Cloudflare', async () => {
	const db = makeD1();
	const fetcher = vi.fn<typeof fetch>();
	const app = platform(db);

	expect((await call(null, app, fetcher)).status).toBe(401);
	expect((await call({ pubkey: 'user' }, app, fetcher)).status).toBe(403);
	expect(fetcher).not.toHaveBeenCalled();
});

it('returns the current UTC counters and configured limits to an admin', async () => {
	const db = makeD1();
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('admin', 'admin-pubkey', 1000)
		.run();
	seedAdmin(db, 'admin');
	const app = platform(db);
	app.env.D1_DAILY_ROWS_READ_LIMIT = '6000000';
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json({
			data: {
				viewer: {
					accounts: [
						{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 6_000_000, rowsWritten: 42 } }] }
					]
				}
			}
		})
	);

	const response = await call({ pubkey: 'admin-pubkey' }, app, fetcher);

	expect(response.status).toBe(200);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(await response.json()).toEqual({
		date: new Date().toISOString().slice(0, 10),
		rowsRead: 6_000_000,
		rowsWritten: 42,
		readLimit: 6_000_000,
		writeLimit: 100_000
	});
	expect(fetcher).toHaveBeenCalledOnce();
});

it('surfaces analytics failure without exposing provider details', async () => {
	const db = makeD1();
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('admin', 'admin-pubkey', 1000)
		.run();
	seedAdmin(db, 'admin');
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	const response = await call(
		{ pubkey: 'admin-pubkey' },
		platform(db),
		vi.fn<typeof fetch>(async () => new Response('provider-secret', { status: 503 }))
	);

	expect(response.status).toBe(503);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(await response.json()).toEqual({
		error: { code: 'd1_limits_unavailable', message: 'Could not retrieve D1 limits' }
	});
});
