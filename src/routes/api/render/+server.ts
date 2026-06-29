import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { parseBody, renderRequestSchema } from '$lib/server/api';
import { mockRender } from '$lib/server/mocks/fixtures';

// Session is enforced centrally in hooks.server.ts (guardedPaths).
export const POST: RequestHandler = async ({ request }) => {
	assertDevOnly();
	const parsed = await parseBody(request, renderRequestSchema);
	if (!parsed.ok) return parsed.response;
	return json(mockRender());
};
