import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { apiError, parseBody, renderRequestSchema } from '$lib/server/api';
import { mockRender } from '$lib/server/mocks/fixtures';

export const POST: RequestHandler = async ({ request, locals }) => {
	assertDevOnly();
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	const parsed = await parseBody(request, renderRequestSchema);
	if (!parsed.ok) return parsed.response;
	return json(mockRender());
};
