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

import { beforeEach, describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import type { D1Database } from '@cloudflare/workers-types';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { makeD1 } from '../testing/d1-shim';
import { CHALLENGE_TTL_MS, NIP98_KIND, SESSION_COOKIE } from './config';
import { consumeChallenge, createChallenge, findValidSession } from './repository';
import { POST as challengePOST } from '../../../routes/auth/challenge/+server';
import { POST as verifyPOST } from '../../../routes/auth/verify/+server';
import { GET as meGET } from '../../../routes/auth/me/+server';
import { POST as logoutPOST } from '../../../routes/auth/logout/+server';
import { PATCH as profilePATCH } from '../../../routes/auth/profile/+server';

const VERIFY_URL = 'https://cadbos.example/auth/verify';
const FEATUREBASE_JWT_SECRET = 'featurebase-test-secret';

type SetOptions = Parameters<Cookies['set']>[2];
type DeleteOptions = Parameters<Cookies['delete']>[1];

interface TestCookies extends Cookies {
	setCalls: { name: string; value: string; options: SetOptions }[];
	deleteCalls: { name: string; options: DeleteOptions }[];
}

function makeCookies(): TestCookies {
	const store = new Map<string, string>();
	const setCalls: TestCookies['setCalls'] = [];
	const deleteCalls: TestCookies['deleteCalls'] = [];
	return {
		setCalls,
		deleteCalls,
		get: (name: string) => store.get(name),
		set: (name: string, value: string, options: SetOptions) => {
			store.set(name, value);
			setCalls.push({ name, value, options });
		},
		delete: (name: string, options: DeleteOptions) => {
			store.delete(name);
			deleteCalls.push({ name, options });
		}
	} as unknown as TestCookies;
}

function requireSessionId(cookies: Cookies): string {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (sessionId === undefined) throw new Error('expected a session cookie to be set');
	return sessionId;
}

function signLogin(secretKey: Uint8Array, challenge: string): Event {
	return finalizeEvent(
		{
			kind: NIP98_KIND,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['u', VERIFY_URL],
				['method', 'POST'],
				['challenge', challenge]
			],
			content: ''
		},
		secretKey
	);
}

const platform = (db: D1Database) =>
	({ env: { DB: db, FEATUREBASE_JWT_SECRET } }) as unknown as App.Platform;

// Invoke an endpoint with a partial RequestEvent. The handler's own signature
// drives the types, so strict mode still validates the fake event's shape.
const call = <Event extends RequestEvent, Result>(
	handler: (event: Event) => Result,
	event: Partial<Event>
): Result => handler(event as Event);

async function requestChallenge(db: D1Database, pubkey: string): Promise<string> {
	const response = await call(challengePOST, {
		request: new Request(VERIFY_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pubkey })
		}),
		platform: platform(db),
		getClientAddress: () => '127.0.0.1'
	});
	return (await response.json()).challenge as string;
}

async function verify(db: D1Database, cookies: Cookies, event: Event): Promise<Response> {
	return call(verifyPOST, {
		request: new Request(VERIFY_URL, {
			method: 'POST',
			headers: { authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}` }
		}),
		platform: platform(db),
		cookies,
		url: new URL(VERIFY_URL),
		getClientAddress: () => '127.0.0.1'
	});
}

describe('auth flow', () => {
	let db: D1Database;

	beforeEach(() => {
		db = makeD1();
	});

	it('challenge → verify signs the user in, sets a session cookie, and creates the user', async () => {
		const sk = generateSecretKey();
		const pubkey = getPublicKey(sk);
		const challenge = await requestChallenge(db, pubkey);
		const cookies = makeCookies();

		const response = await verify(db, cookies, signLogin(sk, challenge));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.user).toEqual({ pubkey });
		expect(jwt.verify(body.featurebaseJwt, FEATUREBASE_JWT_SECRET)).toEqual({
			userId: pubkey,
			iat: expect.any(Number)
		});

		const sessionId = requireSessionId(cookies);
		expect(await findValidSession(db, sessionId, Date.now())).toEqual({ pubkey });

		// The session cookie must be hardened: HttpOnly + Secure + SameSite=Lax,
		// scoped to the whole site, with a future expiry.
		expect(cookies.setCalls).toHaveLength(1);
		const { name, value, options } = cookies.setCalls[0];
		expect(name).toBe(SESSION_COOKIE);
		expect(value).toBe(sessionId);
		expect(options.httpOnly).toBe(true);
		expect(options.secure).toBe(true);
		expect(options.sameSite).toBe('lax');
		expect(options.path).toBe('/');
		expect(options.expires).toBeInstanceOf(Date);
		expect(options.expires!.getTime()).toBeGreaterThan(Date.now());
	});

	it('blocks a replayed challenge (second verify with the same nonce fails 401)', async () => {
		const sk = generateSecretKey();
		const challenge = await requestChallenge(db, getPublicKey(sk));

		const first = await verify(db, makeCookies(), signLogin(sk, challenge));
		expect(first.status).toBe(200);

		const replay = await verify(db, makeCookies(), signLogin(sk, challenge));
		expect(replay.status).toBe(401);
	});

	it('rejects a verify whose pubkey does not match the challenge owner', async () => {
		const challenge = await requestChallenge(db, getPublicKey(generateSecretKey()));
		// A different key signs the same nonce.
		const response = await verify(db, makeCookies(), signLogin(generateSecretKey(), challenge));
		expect(response.status).toBe(401);
	});

	it('logout deletes the session and clears the cookie', async () => {
		const sk = generateSecretKey();
		const challenge = await requestChallenge(db, getPublicKey(sk));
		const cookies = makeCookies();
		await verify(db, cookies, signLogin(sk, challenge));
		const sessionId = requireSessionId(cookies);

		// hooks.server.ts resolves the session into locals before the handler runs;
		// logout mutates the DB only for this verified session.
		const locals = { user: { pubkey: getPublicKey(sk) } };
		const response = await call(logoutPOST, { platform: platform(db), cookies, locals });
		expect(response.status).toBe(204);
		expect(cookies.get(SESSION_COOKIE)).toBeUndefined();
		expect(await findValidSession(db, sessionId, Date.now())).toBeNull();

		// Logout must clear the same cookie, path-scoped to the whole site.
		expect(cookies.deleteCalls).toHaveLength(1);
		expect(cookies.deleteCalls[0].name).toBe(SESSION_COOKIE);
		expect(cookies.deleteCalls[0].options.path).toBe('/');
	});

	it('me returns 401 without a session and the user + balance with one', async () => {
		expect((await call(meGET, { locals: { user: null } })).status).toBe(401);

		// A real (non-demo) user is billing.ts-backed by D1 (Module 6), but there is
		// nothing to show until they've generated at least once — no default balance
		// is provisioned the way the old quota system used to.
		const sk = generateSecretKey();
		const pubkey = getPublicKey(sk);
		const challenge = await requestChallenge(db, pubkey);
		await verify(db, makeCookies(), signLogin(sk, challenge));

		const response = await call(meGET, {
			locals: { user: { pubkey } },
			platform: platform(db)
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.user).toEqual({ pubkey });
		expect(body.balance).toBeUndefined();
	});

	it('updates Cadbos profile fields only for an authenticated user', async () => {
		const sk = generateSecretKey();
		const pubkey = getPublicKey(sk);
		const challenge = await requestChallenge(db, pubkey);
		const cookies = makeCookies();
		await verify(db, cookies, signLogin(sk, challenge));

		const unauthenticated = await call(profilePATCH, {
			request: new Request(VERIFY_URL, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ firstName: 'Ada', lastName: 'Lovelace' })
			}),
			platform: platform(db),
			locals: { user: null }
		});
		expect(unauthenticated.status).toBe(401);

		const response = await call(profilePATCH, {
			request: new Request(VERIFY_URL, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ firstName: ' Ada ', lastName: ' Lovelace ' })
			}),
			platform: platform(db),
			locals: { user: { pubkey } }
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			user: { pubkey, firstName: 'Ada', lastName: 'Lovelace' }
		});
		expect(await findValidSession(db, requireSessionId(cookies), Date.now())).toEqual({
			pubkey,
			firstName: 'Ada',
			lastName: 'Lovelace'
		});

		const firstNameOnly = await call(profilePATCH, {
			request: new Request(VERIFY_URL, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ firstName: 'Grace' })
			}),
			platform: platform(db),
			locals: { user: { pubkey } }
		});
		expect(await firstNameOnly.json()).toEqual({
			user: { pubkey, firstName: 'Grace', lastName: 'Lovelace' }
		});

		const clearLastName = await call(profilePATCH, {
			request: new Request(VERIFY_URL, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ lastName: '' })
			}),
			platform: platform(db),
			locals: { user: { pubkey } }
		});
		expect(await clearLastName.json()).toEqual({
			user: { pubkey, firstName: 'Grace' }
		});

		expect(await findValidSession(db, requireSessionId(cookies), Date.now())).toEqual({
			pubkey,
			firstName: 'Grace'
		});
	});
});

describe('repository challenge atomicity', () => {
	it('consumeChallenge succeeds once and then reports no change', async () => {
		const db = makeD1();
		const now = Date.now();
		await createChallenge(db, 'nonce-1', 'p'.repeat(64), now);

		expect(await consumeChallenge(db, 'nonce-1', 'p'.repeat(64), now - CHALLENGE_TTL_MS, now)).toBe(
			true
		);
		expect(await consumeChallenge(db, 'nonce-1', 'p'.repeat(64), now - CHALLENGE_TTL_MS, now)).toBe(
			false
		);
	});

	it('consumeChallenge rejects an expired nonce', async () => {
		const db = makeD1();
		const now = Date.now();
		await createChallenge(db, 'old', 'p'.repeat(64), now - CHALLENGE_TTL_MS - 1);
		expect(await consumeChallenge(db, 'old', 'p'.repeat(64), now - CHALLENGE_TTL_MS, now)).toBe(
			false
		);
	});
});
