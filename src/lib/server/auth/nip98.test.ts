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

import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { NIP98_KIND } from './config';
import { parseAuthorizationHeader, verifyLoginEvent } from './nip98';

const VERIFY_URL = 'https://cadbos.example/auth/verify';
const NONCE = 'a'.repeat(64);

function signLogin(
	overrides: {
		kind?: number;
		createdAt?: number;
		tags?: string[][];
		secretKey?: Uint8Array;
	} = {}
): Event {
	const sk = overrides.secretKey ?? generateSecretKey();
	return finalizeEvent(
		{
			kind: overrides.kind ?? NIP98_KIND,
			created_at: overrides.createdAt ?? Math.floor(Date.now() / 1000),
			tags: overrides.tags ?? [
				['u', VERIFY_URL],
				['method', 'POST'],
				['challenge', NONCE]
			],
			content: ''
		},
		sk
	);
}

const opts = () => ({ url: VERIFY_URL, method: 'POST', now: Date.now() });

describe('verifyLoginEvent', () => {
	it('accepts a valid NIP-98 login event and returns the signer pubkey', () => {
		const sk = generateSecretKey();
		const event = signLogin({ secretKey: sk });
		const result = verifyLoginEvent(event, opts());
		expect(result).toEqual({ ok: true, pubkey: getPublicKey(sk), challenge: NONCE });
	});

	it('rejects a non-27235 kind', () => {
		const result = verifyLoginEvent(signLogin({ kind: 1 }), opts());
		expect(result).toEqual({ ok: false, reason: 'wrong_kind' });
	});

	it('rejects an event outside the time window (past)', () => {
		const event = signLogin({ createdAt: Math.floor(Date.now() / 1000) - 120 });
		expect(verifyLoginEvent(event, opts())).toEqual({ ok: false, reason: 'expired' });
	});

	it('rejects an event outside the time window (future skew)', () => {
		const event = signLogin({ createdAt: Math.floor(Date.now() / 1000) + 120 });
		expect(verifyLoginEvent(event, opts())).toEqual({ ok: false, reason: 'expired' });
	});

	it('rejects a mismatched url tag', () => {
		const event = signLogin({
			tags: [
				['u', 'https://evil.example/auth/verify'],
				['method', 'POST'],
				['challenge', NONCE]
			]
		});
		expect(verifyLoginEvent(event, opts())).toEqual({ ok: false, reason: 'wrong_url' });
	});

	it('rejects a mismatched method tag', () => {
		const event = signLogin({
			tags: [
				['u', VERIFY_URL],
				['method', 'GET'],
				['challenge', NONCE]
			]
		});
		expect(verifyLoginEvent(event, opts())).toEqual({ ok: false, reason: 'wrong_method' });
	});

	it('rejects a missing challenge tag', () => {
		const event = signLogin({
			tags: [
				['u', VERIFY_URL],
				['method', 'POST']
			]
		});
		expect(verifyLoginEvent(event, opts())).toEqual({ ok: false, reason: 'missing_challenge' });
	});

	it('rejects a tampered event (signature no longer matches)', () => {
		// Round-trip through JSON (as the real header parse does) so nostr-tools'
		// cached `verified` symbol is gone and the signature is actually re-checked.
		const event = JSON.parse(JSON.stringify(signLogin())) as Event;
		const tampered = { ...event, content: 'tampered' };
		expect(verifyLoginEvent(tampered, opts())).toEqual({ ok: false, reason: 'bad_signature' });
	});
});

describe('parseAuthorizationHeader', () => {
	const toHeader = (event: Event) =>
		`Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`;

	it('parses a well-formed Nostr authorization header', () => {
		const event = signLogin();
		// The parsed event comes from JSON, so it lacks nostr-tools' `verified` symbol.
		expect(parseAuthorizationHeader(toHeader(event))).toEqual(JSON.parse(JSON.stringify(event)));
	});

	it('returns null for a missing header', () => {
		expect(parseAuthorizationHeader(null)).toBeNull();
	});

	it('returns null for a wrong scheme', () => {
		expect(parseAuthorizationHeader('Bearer abc')).toBeNull();
	});

	it('returns null for non-base64 / non-JSON payloads', () => {
		expect(parseAuthorizationHeader('Nostr @@@not-base64@@@')).toBeNull();
		expect(
			parseAuthorizationHeader(`Nostr ${Buffer.from('not json', 'utf8').toString('base64')}`)
		).toBeNull();
	});

	it('returns null for JSON that is not event-shaped', () => {
		const header = `Nostr ${Buffer.from(JSON.stringify({ foo: 1 }), 'utf8').toString('base64')}`;
		expect(parseAuthorizationHeader(header)).toBeNull();
	});
});
