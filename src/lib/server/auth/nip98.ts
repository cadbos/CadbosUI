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

// NIP-98 login-event verification (SRS Appendix B.5). The client signs a kind-27235
// HTTP-Auth event carrying `u`, `method` and `challenge` tags. The server checks the
// kind, time window, URL/method tags, the challenge tag, and the schnorr signature
// strictly against the pubkey *inside* the signed event — never a request field.
//
// `challenge` is a Cadbos-specific tag (not part of stock NIP-98), so verification is
// implemented explicitly rather than via nostr-tools' generic NIP-98 helpers.

import { verifyEvent, type Event } from 'nostr-tools/pure';
import { EVENT_TIME_WINDOW_MS, NIP98_KIND } from './config';

export type VerifyResult =
	| { ok: true; pubkey: string; challenge: string }
	| { ok: false; reason: string };

interface VerifyOptions {
	url: string;
	method: string;
	now: number;
}

// Parse an `Authorization: Nostr <base64>` header into a Nostr event. Returns null
// for a missing/malformed header so the caller responds with a generic 401.
export function parseAuthorizationHeader(header: string | null): Event | null {
	if (!header) return null;
	const match = /^Nostr\s+(.+)$/.exec(header.trim());
	if (!match) return null;

	try {
		const json = new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)));
		const value: unknown = JSON.parse(json);
		if (!isEventShaped(value)) return null;
		return value;
	} catch {
		return null;
	}
}

export function verifyLoginEvent(event: Event, { url, method, now }: VerifyOptions): VerifyResult {
	if (event.kind !== NIP98_KIND) return { ok: false, reason: 'wrong_kind' };

	if (Math.abs(now - event.created_at * 1000) > EVENT_TIME_WINDOW_MS) {
		return { ok: false, reason: 'expired' };
	}

	if (getTag(event, 'u') !== url) return { ok: false, reason: 'wrong_url' };

	if (getTag(event, 'method')?.toUpperCase() !== method.toUpperCase()) {
		return { ok: false, reason: 'wrong_method' };
	}

	const challenge = getTag(event, 'challenge');
	if (!challenge) return { ok: false, reason: 'missing_challenge' };

	// Signature last: it binds every field above to the event id and pubkey.
	if (!verifyEvent(event)) return { ok: false, reason: 'bad_signature' };

	return { ok: true, pubkey: event.pubkey, challenge };
}

function getTag(event: Event, name: string): string | undefined {
	return event.tags.find((tag) => tag[0] === name)?.[1];
}

function isEventShaped(value: unknown): value is Event {
	if (typeof value !== 'object' || value === null) return false;
	const e = value as Record<string, unknown>;
	return (
		typeof e.id === 'string' &&
		typeof e.pubkey === 'string' &&
		typeof e.sig === 'string' &&
		typeof e.kind === 'number' &&
		typeof e.created_at === 'number' &&
		typeof e.content === 'string' &&
		Array.isArray(e.tags) &&
		e.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))
	);
}
