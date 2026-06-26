import type { Handle } from '@sveltejs/kit';
import { mockSessionCookie, mockUser } from '$lib/server/mocks/fixtures';

const securityHeaders: Record<string, string> = {
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	// Dev-only mock session: a real Nostr-backed session replaces this in phase C.
	event.locals.user = event.cookies.get(mockSessionCookie) ? mockUser : null;

	const response = await resolve(event);

	for (const [name, value] of Object.entries(securityHeaders)) {
		response.headers.set(name, value);
	}

	return response;
};
