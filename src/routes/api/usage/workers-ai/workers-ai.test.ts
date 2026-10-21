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

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

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

async function adminDb(): Promise<D1Database> {
	const db = makeD1();
	await db
		.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('admin', 'admin-pubkey', 1000)
		.run();
	await seedAdmin(db, 'admin');
	return db;
}

function analytics(groups: unknown[]): typeof fetch {
	return vi.fn<typeof fetch>(async () =>
		Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: groups }] } } })
	);
}

afterEach(() => {
	vi.restoreAllMocks();
});

it('requires an authenticated admin before querying Cloudflare', async () => {
	const fetcher = vi.fn<typeof fetch>();
	const app = platform(makeD1());

	expect((await call(null, app, fetcher)).status).toBe(401);
	expect((await call({ pubkey: 'user' }, app, fetcher)).status).toBe(403);
	expect(fetcher).not.toHaveBeenCalled();
});

it("sums today's account-wide Workers AI requests and Neurons across models", async () => {
	const fetcher = analytics([
		{ count: 177, sum: { totalNeurons: 161.25 } },
		{ count: 3, sum: { totalNeurons: 0.5 } }
	]);

	const response = await call({ pubkey: 'admin-pubkey' }, platform(await adminDb()), fetcher);

	expect(response.status).toBe(200);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(await response.json()).toEqual({
		date: new Date().toISOString().slice(0, 10),
		requests: 180,
		neurons: 161.75,
		neuronLimit: 10_000
	});
	const [url, init] = vi.mocked(fetcher).mock.calls[0];
	expect(url).toBe(GRAPHQL_URL);
	expect(init?.headers).toMatchObject({ authorization: 'Bearer analytics-token' });
	expect(JSON.parse(String(init?.body))).toMatchObject({
		query: expect.stringContaining('aiInferenceAdaptiveGroups'),
		variables: { accountTag: 'account-id', date: new Date().toISOString().slice(0, 10) }
	});
});

it('reports zero usage before the first Workers AI call of the day', async () => {
	const response = await call({ pubkey: 'admin-pubkey' }, platform(await adminDb()), analytics([]));

	expect(await response.json()).toMatchObject({ requests: 0, neurons: 0 });
});

it.each([
	[
		'an HTTP error',
		vi.fn<typeof fetch>(async () => new Response('provider-secret', { status: 503 }))
	],
	['a malformed group', analytics([{ count: 1, sum: {} }])]
])('surfaces %s without exposing provider details', async (_, fetcher) => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);

	const response = await call({ pubkey: 'admin-pubkey' }, platform(await adminDb()), fetcher);

	expect(response.status).toBe(503);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(await response.json()).toEqual({
		error: { code: 'workers_ai_usage_unavailable', message: 'Could not retrieve Workers AI usage' }
	});
});

it('reports unavailable usage when the analytics credentials are missing', async () => {
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	const fetcher = vi.fn<typeof fetch>();
	const app = platform(await adminDb());
	delete app.env.CLOUDFLARE_ANALYTICS_API_TOKEN;

	const response = await call({ pubkey: 'admin-pubkey' }, app, fetcher);

	expect(response.status).toBe(503);
	expect(fetcher).not.toHaveBeenCalled();
	expect(warning).toHaveBeenCalledWith(
		JSON.stringify({ event: 'workers_ai_quota_configuration_invalid' })
	);
});
