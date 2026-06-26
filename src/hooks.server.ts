import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { defaultLocale } from '$lib/i18n/index.svelte';
import { mockSessionCookie, mockUser } from '$lib/server/mocks/fixtures';

const securityHeaders: Record<string, string> = {
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	// Mock session, dev-only: the cookie grants a session solely under `dev`, so a
	// production build never trusts it. Replaced by real Nostr auth in phase C.
	event.locals.user = dev && event.cookies.get(mockSessionCookie) ? mockUser : null;

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', defaultLocale)
	});

	for (const [name, value] of Object.entries(securityHeaders)) {
		response.headers.set(name, value);
	}

	return response;
};
