import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ChallengeResponse } from '$lib/api/contract';
import { apiError, challengeRequestSchema, parseBody } from '$lib/server/api';
import { AUTH_RATE_LIMIT } from '$lib/server/auth/config';
import { createChallenge, getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { randomToken } from '$lib/server/auth/session';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const db = getDb(platform);
	const now = Date.now();

	if (await touchRateLimit(db, `challenge:${getClientAddress()}`, now, AUTH_RATE_LIMIT)) {
		return apiError(429, 'rate_limited', 'Too many requests');
	}

	const parsed = await parseBody(request, challengeRequestSchema);
	if (!parsed.ok) return parsed.response;

	const nonce = randomToken();
	await createChallenge(db, nonce, parsed.data.pubkey, now);
	return json({ challenge: nonce } satisfies ChallengeResponse);
};
