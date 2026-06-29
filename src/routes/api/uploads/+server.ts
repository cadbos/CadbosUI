import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertDevOnly } from '$lib/server/dev';
import { mockUpload } from '$lib/server/mocks/fixtures';

// Session is enforced centrally in hooks.server.ts (guardedPaths).
export const POST: RequestHandler = () => {
	assertDevOnly();
	// File-type/size/count enforcement lives in the real UploadThing file router
	// (phase C); the mock has no uploaded file to validate.
	return json(mockUpload());
};
