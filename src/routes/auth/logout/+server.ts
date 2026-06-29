import type { RequestHandler } from './$types';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { deleteSession, getDb } from '$lib/server/auth/repository';
import { clearSessionCookie } from '$lib/server/auth/session';

export const POST: RequestHandler = async ({ platform, cookies, locals }) => {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (locals.user && sessionId) await deleteSession(getDb(platform), sessionId);
	clearSessionCookie(cookies);
	return new Response(null, { status: 204 });
};
