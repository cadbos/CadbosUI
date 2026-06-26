import { beforeEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import type { D1Database } from '@cloudflare/workers-types';
import type { Cookies } from '@sveltejs/kit';
import { NIP98_KIND, SESSION_COOKIE } from './config';
import { consumeChallenge, createChallenge, findValidSession } from './repository';
import { POST as challengePOST } from '../../../routes/auth/challenge/+server';
import { POST as verifyPOST } from '../../../routes/auth/verify/+server';
import { GET as meGET } from '../../../routes/auth/me/+server';
import { POST as logoutPOST } from '../../../routes/auth/logout/+server';

const SCHEMA = readFileSync(
	new URL('../../../../migrations/0001_auth.sql', import.meta.url),
	'utf8'
);
const VERIFY_URL = 'https://cadbos.example/auth/verify';

// Minimal D1Database shim over node:sqlite — exercises the real SQL (atomic upserts,
// RETURNING, UNIQUE constraints) without a Workers runtime.
function makeD1(): D1Database {
	const db = new DatabaseSync(':memory:');
	db.exec(SCHEMA);
	const stmt = (sql: string, args: SQLInputValue[] = []) => ({
		bind: (...next: SQLInputValue[]) => stmt(sql, next),
		run: () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
		first: (col?: string) => {
			const row = db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
			if (row === undefined) return null;
			return col ? row[col] : row;
		}
	});
	return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

function makeCookies(): Cookies {
	const store = new Map<string, string>();
	return {
		get: (name: string) => store.get(name),
		set: (name: string, value: string) => store.set(name, value),
		delete: (name: string) => void store.delete(name)
	} as unknown as Cookies;
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

const platform = (db: D1Database) => ({ env: { DB: db } }) as unknown as App.Platform;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (handler: any, args: Record<string, unknown>) => handler(args);

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

function verify(db: D1Database, cookies: Cookies, event: Event): Promise<Response> {
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
		expect((await response.json()).user).toEqual({ pubkey });

		const sessionId = cookies.get(SESSION_COOKIE);
		expect(sessionId).toBeTruthy();
		expect(await findValidSession(db, sessionId!, Date.now())).toEqual({ pubkey });
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
		const sessionId = cookies.get(SESSION_COOKIE)!;

		const response = await call(logoutPOST, { platform: platform(db), cookies });
		expect(response.status).toBe(204);
		expect(cookies.get(SESSION_COOKIE)).toBeUndefined();
		expect(await findValidSession(db, sessionId, Date.now())).toBeNull();
	});

	it('me returns 401 without a session and the user + quota with one', async () => {
		expect((await call(meGET, { locals: { user: null } })).status).toBe(401);

		const response = await call(meGET, { locals: { user: { pubkey: 'a'.repeat(64) } } });
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.user).toEqual({ pubkey: 'a'.repeat(64) });
		expect(body.quota).toMatchObject({ period: expect.any(String) });
	});
});

describe('repository challenge atomicity', () => {
	it('consumeChallenge succeeds once and then reports no change', async () => {
		const db = makeD1();
		const now = Date.now();
		await createChallenge(db, 'nonce-1', 'p'.repeat(64), now);

		expect(await consumeChallenge(db, 'nonce-1', 'p'.repeat(64), now - 60_000, now)).toBe(true);
		expect(await consumeChallenge(db, 'nonce-1', 'p'.repeat(64), now - 60_000, now)).toBe(false);
	});

	it('consumeChallenge rejects an expired nonce', async () => {
		const db = makeD1();
		const now = Date.now();
		await createChallenge(db, 'old', 'p'.repeat(64), now - 120_000);
		expect(await consumeChallenge(db, 'old', 'p'.repeat(64), now - 60_000, now)).toBe(false);
	});
});
