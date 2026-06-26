import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { apiError } from '$lib/server/api';
import { mockMe } from '$lib/server/mocks/fixtures';

export const GET: RequestHandler = ({ locals }) => {
	assertDevOnly();
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	return json(mockMe());
};
