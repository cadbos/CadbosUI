import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError } from '$lib/server/api';
import { uploadImage, imageExtensionFromMime } from '$lib/server/uploads';

// FR-Ж1/И-UT-3: 8 MB max, enforced server-side — the client-side check in
// ImageUpload.svelte is a UX nicety, not a trust boundary.
const MAX_UPLOAD_SIZE = 8 * 1024 * 1024;

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

	if (imageExtensionFromMime(file.type) === null) {
		return apiError(400, 'invalid_request', 'Unsupported image type');
	}

	if (file.size > MAX_UPLOAD_SIZE) {
		return apiError(400, 'invalid_request', 'File exceeds the 8 MB limit');
	}

	try {
		const result = await uploadImage(platform, file);
		return json({ ...result, url: new URL(result.url, request.url).toString() });
	} catch (err) {
		// Provider/internal detail stays server-side (NFR-6/8) — the client only
		// ever sees a generic failure.
		console.error('Upload failed:', err);
		return apiError(500, 'upload_failed', 'Upload failed');
	}
};
