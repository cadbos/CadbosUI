// Auth configuration (SRS Appendix B.11 / ОВ-11). Centralised so the values are
// configurable in one place rather than hardcoded at each call site.

import type { Quota } from '$lib/api/contract';

// NIP-98 HTTP-Auth event kind (the signed login event).
export const NIP98_KIND = 27235;

// Login challenge: single-use nonce, short TTL.
export const CHALLENGE_TTL_MS = 60_000;

// Accepted clock skew for the signed event's `created_at` (±, in ms).
export const EVENT_TIME_WINDOW_MS = 60_000;

// Server session lifetime. A dedicated "remember me" lifetime is post-MVP.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// HttpOnly session cookie name.
export const SESSION_COOKIE = 'cadbos_session';

// Fixed-window rate limit for /auth/challenge and /auth/verify (per client IP).
export const AUTH_RATE_LIMIT = { windowMs: 60_000, max: 20 } as const;

// Starter quota returned by /auth/me until Module 6 owns billing/limits.
export const DEFAULT_QUOTA: Quota = { balanceOrLimit: 0, usage: 0, period: 'month' };
