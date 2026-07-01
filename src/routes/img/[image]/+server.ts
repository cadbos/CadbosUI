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

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { imageCacheControl, parseProxyImageName } from '$lib/server/image-utils';

// Public — no session required. The render service fetches this URL server-side.
export const GET: RequestHandler = async ({ params, platform }) => {
	const parsed = parseProxyImageName(params.image);
	if (parsed === null) throw error(400, 'Invalid image path');

	const bucket = platform?.env?.UPLOADS_BUCKET;
	if (!bucket) throw error(503, 'Storage not configured');

	const key = `${parsed.fileKey}.${parsed.extension}`;
	const object = await bucket.get(key);
	if (!object) throw error(404, 'Image not found');

	return new Response(await object.arrayBuffer(), {
		headers: {
			'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'cache-control': imageCacheControl(),
			etag: object.httpEtag
		}
	});
};
