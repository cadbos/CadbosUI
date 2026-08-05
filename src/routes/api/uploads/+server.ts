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
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, remoteImageUploadRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { findGenerationSourceByHash } from '$lib/server/generations';
import { normalizeImageContentType } from '$lib/image-mime';
import {
	MAX_IMAGE_UPLOAD_SIZE,
	RemoteImageImportError,
	importRemoteImage
} from '$lib/server/remote-image';
import { hashBytes, isStoredUploadUrl, uploadImageBytes } from '$lib/server/uploads';

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

export const POST: RequestHandler = async ({ request, platform, url, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	// The demo session bypasses D1 entirely (hooks.server.ts) — no account row
	// to dedup against, so uploads for it always go straight to R2.
	const demoUser = dev && locals.user.pubkey === DEMO_PUBKEY;
	const db = demoUser ? null : getDb(platform);
	const userId = db ? await getUserIdByPubkey(db, locals.user.pubkey) : null;
	if (db && !userId) return apiError(500, 'account_error', 'Account record not found');

	// generations.source_url isn't always a stored upload — render/edit calls
	// record their output URL there too (recordGeneration) — so a hash match
	// is only reused when it actually resolves to our own bucket; otherwise
	// this falls through to a normal upload rather than handing back an
	// arbitrary URL as if it were deduped.
	const publicUrl = platform?.env?.UPLOADS_PUBLIC_URL;
	const findExisting =
		db && userId && publicUrl
			? async (hash: string) => {
					const existingUrl = await findGenerationSourceByHash(db, userId, hash);
					return existingUrl && isStoredUploadUrl(existingUrl, publicUrl) ? existingUrl : null;
				}
			: undefined;

	if (request.headers.get('content-type')?.startsWith('application/json')) {
		const body: unknown = await request.json().catch(() => null);
		const parsed = remoteImageUploadRequestSchema.safeParse(body);
		if (!parsed.success) return apiError(400, 'invalid_url', 'Invalid image URL');

		try {
			return json(
				await importRemoteImage(
					platform,
					parsed.data.url,
					url.origin,
					globalThis.fetch,
					findExisting
				)
			);
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

	const normalizedMime = normalizeImageContentType(file.type);
	if (normalizedMime === null)
		return apiError(415, 'unsupported_image_type', 'Unsupported image type');

	if (file.size > MAX_IMAGE_UPLOAD_SIZE)
		return apiError(413, 'image_too_large', 'File exceeds the 8 MB limit');

	try {
		const bytes = await file.arrayBuffer();
		const hash = await hashBytes(bytes);
		const existingUrl = await findExisting?.(hash);
		const result = existingUrl
			? { url: existingUrl, mime: normalizedMime, size: bytes.byteLength, hash }
			: await uploadImageBytes(platform, bytes, file.type, undefined, hash);
		return json(result);
	} catch (err) {
		console.error('Upload failed:', err);
		return apiError(500, 'upload_failed', 'Upload failed');
	}
};
