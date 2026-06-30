import { dev } from '$app/environment';
import { UTApi } from 'uploadthing/server';
import type { UploadResult } from '$lib/api/contract';
import { mockUpload } from '$lib/server/mocks/fixtures';

export async function uploadImage(
	platform: App.Platform | undefined,
	file: File
): Promise<UploadResult> {
	const token = platform?.env?.UPLOADTHING_TOKEN;

	if (!token) {
		if (dev) return mockUpload();
		throw new Error('UPLOADTHING_TOKEN not configured');
	}

	const utapi = new UTApi({ token });
	const { data, error } = await utapi.uploadFiles(file);

	if (error || !data) {
		throw new Error(error?.message ?? 'Upload failed');
	}

	// Append the original filename so the URL includes a file extension.
	// The render API requires an extension to identify the image format.
	const baseUrl = data.ufsUrl;
	const url = `${baseUrl}/${encodeURIComponent(file.name)}`;

	return {
		url,
		mime: file.type,
		size: file.size
	};
}
