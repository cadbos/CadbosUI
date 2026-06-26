import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { MeResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { DEFAULT_QUOTA } from '$lib/server/auth/config';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	// Quota is starter scaffolding until Module 6 owns billing/limits.
	return json({ user: locals.user, quota: DEFAULT_QUOTA } satisfies MeResponse);
};
