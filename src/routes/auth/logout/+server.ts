import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { mockSessionCookie } from '$lib/server/mocks/fixtures';

export const POST: RequestHandler = ({ cookies }) => {
	assertDevOnly();
	cookies.delete(mockSessionCookie, { path: '/' });
	return new Response(null, { status: 204 });
};
