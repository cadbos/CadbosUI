import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { mockMe } from '$lib/server/mocks/fixtures';

export const GET: RequestHandler = ({ locals }) => {
	assertDevOnly();
	if (!locals.user) error(401, 'Unauthorized');
	return json(mockMe());
};
