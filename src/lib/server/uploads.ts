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

import { dev } from '$app/environment';
import { imageExtensionFromMime } from '$lib/server/image-utils';
import { mockUpload } from '$lib/server/mocks/fixtures';

export { imageExtensionFromMime };

export async function uploadImage(
	platform: App.Platform | undefined,
	file: File
): Promise<{ url: string; mime: string; size: number }> {
	const bucket = platform?.env?.UPLOADS_BUCKET;
	const publicUrl = platform?.env?.UPLOADS_PUBLIC_URL;

	if (!bucket) {
		if (dev) return mockUpload();
		throw new Error('UPLOADS_BUCKET not configured');
	}

	if (!publicUrl) throw new Error('UPLOADS_PUBLIC_URL not configured');

	const extension = imageExtensionFromMime(file.type);
	if (extension === null) throw new Error(`Unsupported image type: ${file.type}`);

	const key = `${crypto.randomUUID()}.${extension}`;
	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type }
	});

	return {
		url: new URL(key, publicUrl).toString(),
		mime: file.type,
		size: file.size
	};
}
