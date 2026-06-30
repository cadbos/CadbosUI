import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { editRequestSchema, parseBody } from '$lib/server/api';
import { mockEdit } from '$lib/server/mocks/fixtures';

// Session is enforced centrally in hooks.server.ts (guardedPaths).
export const POST: RequestHandler = async ({ request }) => {
	assertDevOnly();
	const parsed = await parseBody(request, editRequestSchema);
	if (!parsed.ok) return parsed.response;
	return json(mockEdit());
};
