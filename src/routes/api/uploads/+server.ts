import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { apiError } from '$lib/server/api';
import { mockUpload } from '$lib/server/mocks/fixtures';

export const POST: RequestHandler = ({ locals }) => {
	assertDevOnly();
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');
	// File-type/size/count enforcement lives in the real UploadThing file router
	// (phase C); the mock has no uploaded file to validate.
	return json(mockUpload());
};
