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

// Demo-mode constants used across the demo/showcase branch.
// All demo logic is gated behind the `dev` flag from $app/environment
// so nothing leaks into production builds.

import type { Quota, SessionUser } from '$lib/api/contract';

// A predictable session id that hooks.server.ts recognises without hitting D1.
export const DEMO_SESSION_ID = 'cadbos-demo-session-showcase-2026';

// A deterministic pubkey that can never collide with a real Nostr key generated
// from a private key (the discrete-log inverse of 0x01 is not a valid secret key
// for production use, and we never expose a private key for this pubkey anyway).
export const DEMO_PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';

export const DEMO_USER: SessionUser = {
	pubkey: DEMO_PUBKEY,
	firstName: 'Demo',
	lastName: 'User'
};

export const DEMO_QUOTA: Quota = {
	balanceOrLimit: 50,
	usage: 2,
	period: 'demo'
};
