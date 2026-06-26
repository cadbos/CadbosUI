import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { apiError } from '$lib/server/api';
import { mockSessionCookie, mockUser } from '$lib/server/mocks/fixtures';

export const POST: RequestHandler = ({ request, cookies }) => {
	assertDevOnly();
	// The real verify checks a NIP-98 signature (phase C); the mock only enforces
	// the `Authorization: Nostr <base64>` shape so the contract is exercised.
	const authorization = request.headers.get('authorization') ?? '';
	if (!/^Nostr\s+.+/.test(authorization)) {
		return apiError(401, 'invalid_authorization', 'Missing Nostr authorization');
	}
	cookies.set(mockSessionCookie, '1', {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax'
	});
	return json({ user: mockUser });
};
