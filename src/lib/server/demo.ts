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
