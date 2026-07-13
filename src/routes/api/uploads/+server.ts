/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, remoteImageUploadRequestSchema } from '$lib/server/api';
import { imageExtensionFromMime } from '$lib/server/image-utils';
import {
	MAX_IMAGE_UPLOAD_SIZE,
	RemoteImageImportError,
	importRemoteImage
} from '$lib/server/remote-image';
import { uploadImage } from '$lib/server/uploads';

function remoteImportErrorResponse(error: RemoteImageImportError): Response {
	switch (error.code) {
		case 'invalid_url':
			return apiError(400, error.code, 'Invalid image URL');
		case 'unsupported_image_type':
			return apiError(415, error.code, 'Unsupported image type');
		case 'image_too_large':
			return apiError(413, error.code, 'Image exceeds the 8 MB limit');
		case 'remote_fetch_failed':
			return apiError(502, error.code, 'Failed to fetch image');
	}
}

export const POST: RequestHandler = async ({ request, platform, url }) => {
	if (request.headers.get('content-type')?.startsWith('application/json')) {
		const body: unknown = await request.json().catch(() => null);
		const parsed = remoteImageUploadRequestSchema.safeParse(body);
		if (!parsed.success) return apiError(400, 'invalid_url', 'Invalid image URL');

		try {
			return json(await importRemoteImage(platform, parsed.data.url, url.origin));
		} catch (error) {
			if (error instanceof RemoteImageImportError) return remoteImportErrorResponse(error);
			console.error('Remote image import failed:', error);
			return apiError(500, 'upload_failed', 'Upload failed');
		}
	}

	let file: File | null = null;
	try {
		const formData = await request.formData();
		const entry = formData.get('file');
		if (entry instanceof File) file = entry;
	} catch (error) {
		console.error(
			'Upload form data parse failed:',
			error instanceof Error ? error.name : typeof error
		);
	}

	if (!file) return apiError(400, 'invalid_request', 'Expected a file in the "file" field');

	if (imageExtensionFromMime(file.type) === null)
		return apiError(415, 'unsupported_image_type', 'Unsupported image type');

	if (file.size > MAX_IMAGE_UPLOAD_SIZE)
		return apiError(413, 'image_too_large', 'File exceeds the 8 MB limit');

	try {
		const result = await uploadImage(platform, file);
		return json(result);
	} catch (err) {
		console.error('Upload failed:', err);
		return apiError(500, 'upload_failed', 'Upload failed');
	}
};
