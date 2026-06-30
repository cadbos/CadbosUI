import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError } from '$lib/server/api';
import { uploadImage } from '$lib/server/uploads';

// Session is enforced centrally in hooks.server.ts (guardedPaths).
export const POST: RequestHandler = async ({ request, platform }) => {
	let file: File | null = null;
	try {
		const formData = await request.formData();
		const entry = formData.get('file');
		if (entry instanceof File) file = entry;
	} catch {
		// fall through
	}

	if (!file) return apiError(400, 'invalid_request', 'Expected a file in the "file" field');

	try {
		const result = await uploadImage(platform, file);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Upload failed';
		return apiError(500, 'upload_failed', message);
	}
};
