import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { apiError } from '$lib/server/api';
import { uploadImage } from '$lib/server/uploads';
import {
	imageExtensionFromMime,
	parseUploadthingStorageUrl,
	proxiedUploadthingImageUrl
} from '$lib/server/uploadthing-images';

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

	const extension = imageExtensionFromMime(file.type);
	if (extension === null) return apiError(400, 'invalid_request', 'Unsupported image type');

	try {
		const result = await uploadImage(platform, file);
		const storage = parseUploadthingStorageUrl(result.url);

		if (storage === null) {
			if (dev) return json(result);
			throw new Error('Upload returned an unsupported image URL');
		}

		return json({
			...result,
			url: proxiedUploadthingImageUrl(request.url, storage.fileKey, extension)
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Upload failed';
		return apiError(500, 'upload_failed', message);
	}
};
