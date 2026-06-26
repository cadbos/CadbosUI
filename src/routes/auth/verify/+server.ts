import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SessionUser } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { AUTH_RATE_LIMIT, CHALLENGE_TTL_MS, SESSION_TTL_MS } from '$lib/server/auth/config';
import {
	consumeChallenge,
	createSession,
	findOrCreateUser,
	getDb
} from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { parseAuthorizationHeader, verifyLoginEvent } from '$lib/server/auth/nip98';
import { randomToken, setSessionCookie } from '$lib/server/auth/session';
import { logAuthFailure } from '$lib/server/auth/events';

export const POST: RequestHandler = async ({
	request,
	platform,
	cookies,
	url,
	getClientAddress
}) => {
	const db = getDb(platform);
	const now = Date.now();

	if (await touchRateLimit(db, `verify:${getClientAddress()}`, now, AUTH_RATE_LIMIT)) {
		return apiError(429, 'rate_limited', 'Too many requests');
	}

	const event = parseAuthorizationHeader(request.headers.get('authorization'));
	if (!event) {
		logAuthFailure('verify_bad_header');
		return apiError(401, 'invalid_authorization', 'Missing or malformed authorization');
	}

	const result = verifyLoginEvent(event, {
		url: `${url.origin}${url.pathname}`,
		method: 'POST',
		now
	});
	if (!result.ok) {
		logAuthFailure('verify_invalid_event', { reason: result.reason });
		return apiError(401, 'invalid_authorization', 'Invalid authorization');
	}

	const consumed = await consumeChallenge(
		db,
		result.challenge,
		result.pubkey,
		now - CHALLENGE_TTL_MS,
		now
	);
	if (!consumed) {
		logAuthFailure('verify_challenge_rejected', { pubkey: result.pubkey });
		return apiError(401, 'invalid_authorization', 'Invalid authorization');
	}

	const user = await findOrCreateUser(db, result.pubkey, now);
	const sessionId = randomToken();
	const expiresAt = now + SESSION_TTL_MS;
	await createSession(db, sessionId, user.id, now, expiresAt, request.headers.get('user-agent'));
	setSessionCookie(cookies, sessionId, new Date(expiresAt));

	const sessionUser: SessionUser = {
		pubkey: user.pubkey,
		...(user.first_name ? { firstName: user.first_name } : {}),
		...(user.last_name ? { lastName: user.last_name } : {})
	};
	return json({ user: sessionUser });
};
