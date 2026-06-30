import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { MeResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { DEMO_PUBKEY, DEMO_QUOTA } from '$lib/server/demo';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const quota =
		dev && locals.user.pubkey === DEMO_PUBKEY ? DEMO_QUOTA : undefined;

	return json({ user: locals.user, quota } satisfies MeResponse);
};
