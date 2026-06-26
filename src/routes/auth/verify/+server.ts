import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { mockSessionCookie, mockUser } from '$lib/server/mocks/fixtures';

export const POST: RequestHandler = ({ cookies }) => {
	assertDevOnly();
	cookies.set(mockSessionCookie, '1', {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax'
	});
	return json({ user: mockUser });
};
