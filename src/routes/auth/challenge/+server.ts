import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { challengeRequestSchema, parseBody } from '$lib/server/api';
import { mockChallenge } from '$lib/server/mocks/fixtures';

export const POST: RequestHandler = async ({ request }) => {
	assertDevOnly();
	const parsed = await parseBody(request, challengeRequestSchema);
	if (!parsed.ok) return parsed.response;
	return json(mockChallenge());
};
