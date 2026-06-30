import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { defaultLocale } from '$lib/i18n/index.svelte';
import { apiError } from '$lib/server/api';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { findValidSession, getDb } from '$lib/server/auth/repository';
import { DEMO_SESSION_ID, DEMO_USER } from '$lib/server/demo';

const securityHeaders: Record<string, string> = {
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

// Endpoints that require an authenticated session (FR-И1, AC-11). Guarded centrally
// so a new route under these prefixes can't accidentally ship unauthenticated.
const guardedPaths = ['/api/render', '/api/edit', '/api/uploads'];

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(SESSION_COOKIE);

	// Demo bypass: in dev mode a special session cookie skips D1 entirely so the
	// showcase branch works without a local D1 database being configured.
	if (dev && sessionId === DEMO_SESSION_ID) {
		event.locals.user = DEMO_USER;
	} else {
		event.locals.user = sessionId
			? await findValidSession(getDb(event.platform), sessionId, Date.now())
			: null;
	}

	const blocked =
		!event.locals.user && guardedPaths.some((path) => event.url.pathname.startsWith(path));

	const response = blocked
		? apiError(401, 'unauthorized', 'Authentication required')
		: await resolve(event, {
				transformPageChunk: ({ html }) => html.replace('%lang%', defaultLocale)
			});

	for (const [name, value] of Object.entries(securityHeaders)) {
		response.headers.set(name, value);
	}

	return response;
};
