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
import type { SessionUser, UsageProfilesResponse } from '$lib/api/contract';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { POST } from './+server';

const fetchNostrProfile = vi.hoisted(() => vi.fn());

vi.mock('$lib/nostr/profile', () => ({ fetchNostrProfile }));

const ADMIN_PUBKEY = 'a'.repeat(64);
const USER_PUBKEY = 'b'.repeat(64);

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, 1000)
		.run();
}

function platform(db: D1Database, adminPubkeys = ADMIN_PUBKEY): App.Platform {
	return { env: { DB: db, ADMIN_PUBKEYS: adminPubkeys } } as App.Platform;
}

type ProfilesEvent = Parameters<typeof POST>[0];

function call(
	user: SessionUser | null,
	db: D1Database,
	body: unknown,
	adminPubkeys = ADMIN_PUBKEY
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/usage/profiles', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		platform: platform(db, adminPubkeys),
		locals: { user }
	} as ProfilesEvent);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/usage/profiles', () => {
	it('returns 401 when no session is present', async () => {
		const response = await call(null, makeD1(), { pubkeys: [USER_PUBKEY] });

		expect(response.status).toBe(401);
	});

	it('returns 403 for non-admin users', async () => {
		const db = makeD1();
		seedUser(db, 'user', USER_PUBKEY);

		const response = await call({ pubkey: USER_PUBKEY }, db, { pubkeys: [USER_PUBKEY] });

		expect(response.status).toBe(403);
	});

	it('validates the requested pubkeys', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY);

		const response = await call({ pubkey: ADMIN_PUBKEY }, db, { pubkeys: ['not-a-pubkey'] });

		expect(response.status).toBe(400);
	});

	it('returns name and picture without relay metadata', async () => {
		const db = makeD1();
		seedUser(db, 'admin', ADMIN_PUBKEY);
		fetchNostrProfile.mockResolvedValue({
			name: 'Alice',
			picture: 'https://avatar.example/alice.png',
			about: 'Private profile detail',
			relays: [{ url: 'wss://relay.example', read: true, write: true }]
		});

		const response = await call({ pubkey: ADMIN_PUBKEY }, db, {
			pubkeys: [USER_PUBKEY, USER_PUBKEY]
		});
		const body = (await response.json()) as UsageProfilesResponse;

		expect(response.status).toBe(200);
		expect(fetchNostrProfile).toHaveBeenCalledTimes(1);
		expect(fetchNostrProfile).toHaveBeenCalledWith(USER_PUBKEY);
		expect(body).toEqual({
			profiles: {
				[USER_PUBKEY]: { name: 'Alice', picture: 'https://avatar.example/alice.png' }
			}
		});
	});
});
