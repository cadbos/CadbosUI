import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { MeResponse } from '$lib/api/contract';
import { apiError } from '$lib/server/api';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	return json({ user: locals.user } satisfies MeResponse);
};
