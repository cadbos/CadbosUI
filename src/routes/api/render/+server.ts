import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { mockRender } from '$lib/server/mocks/fixtures';

export const POST: RequestHandler = () => {
	assertDevOnly();
	return json(mockRender());
};
