import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { MeResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getOrCreateQuota, getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY, DEMO_QUOTA } from '$lib/server/demo';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	// The demo session bypasses D1 entirely (hooks.server.ts) and always gets the
	// hardcoded showcase quota; real sessions are always backed by a D1 user row.
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return json({ user: locals.user, quota: DEMO_QUOTA } satisfies MeResponse);
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	const quota = userId ? await getOrCreateQuota(db, userId) : undefined;

	return json({ user: locals.user, quota } satisfies MeResponse);
};
