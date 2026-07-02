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

// Server session helpers: token generation and the HttpOnly session cookie.
// The session id is rotated on every successful login (a fresh token is issued).

import type { Cookies } from '@sveltejs/kit';
import { SESSION_COOKIE } from './config';

// 256 bits of CSPRNG entropy, hex-encoded. Used for both session ids and challenge
// nonces — neither is guessable.
export function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function setSessionCookie(cookies: Cookies, id: string, expires: Date): void {
	cookies.set(SESSION_COOKIE, id, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		expires
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
