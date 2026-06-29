export const NIP98_KIND = 27235;

export const CHALLENGE_TTL_MS = 60_000;

export const EVENT_TIME_WINDOW_MS = 60_000;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'cadbos_session';

export const AUTH_RATE_LIMIT = { windowMs: 60_000, max: 20 } as const;
