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

import type { RequestHandler } from './$types';
import { normalizeImageContentType } from '$lib/image-mime';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getMediaByBucketKey } from '$lib/server/media';
import { presignS3Object } from '$lib/server/s3';

function downloadFailed(): Response {
	return apiError(502, 'download_failed', 'Image download failed');
}

export const GET: RequestHandler = async ({ fetch, params, platform }) => {
	if (!params.bucket || !params.filename) {
		return apiError(404, 'image_not_found', 'Image not found');
	}

	const media = await getMediaByBucketKey(getDb(platform), params.bucket, params.filename);
	if (!media) return apiError(404, 'image_not_found', 'Image not found');

	let upstream: Response;
	try {
		const url = await presignS3Object(platform, media.bucket, media.filename, 'ui');
		upstream = await fetch(url);
	} catch (error) {
		console.error('Media download failed:', error instanceof Error ? error.name : typeof error);
		return downloadFailed();
	}

	const contentType = normalizeImageContentType(upstream.headers.get('content-type'));
	if (!upstream.ok || !upstream.body || contentType === null) {
		console.error('Media download failed:', `invalid upstream response (${upstream.status})`);
		return downloadFailed();
	}

	return new Response(upstream.body, {
		headers: {
			'cache-control': 'private, no-store',
			'content-disposition': 'attachment',
			'content-type': contentType
		}
	});
};
