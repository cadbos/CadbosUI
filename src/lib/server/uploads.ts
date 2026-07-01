import { dev } from '$app/environment';
import { imageExtensionFromMime } from '$lib/server/image-utils';
import { mockUpload } from '$lib/server/mocks/fixtures';

export { imageExtensionFromMime };

export async function uploadImage(
	platform: App.Platform | undefined,
	file: File
): Promise<{ url: string; mime: string; size: number }> {
	const bucket = platform?.env?.UPLOADS_BUCKET;

	if (!bucket) {
		if (dev) return mockUpload();
		throw new Error('UPLOADS_BUCKET not configured');
	}

	const extension = imageExtensionFromMime(file.type);
	if (extension === null) throw new Error(`Unsupported image type: ${file.type}`);

	const key = `${crypto.randomUUID()}.${extension}`;
	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type }
	});

	return { url: `/img/${key}`, mime: file.type, size: file.size };
}
