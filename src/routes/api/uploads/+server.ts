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
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { findGenerationSourceByHash } from '$lib/server/generations';
import { getBucketByName, getOrCreateMediaByKey, getMedia } from '$lib/server/media';
import { mediaAccess } from '$lib/server/media-access';
import { normalizeImageContentType } from '$lib/image-mime';
import {
	MAX_IMAGE_UPLOAD_SIZE,
	RemoteImageImportError,
	importRemoteImage
} from '$lib/server/remote-image';
import { hashBytes, uploadImageBytes } from '$lib/server/uploads';

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
	if (!locals.user) {
		return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	}

	// Demo sessions skip account lookup and deduplication, but still use D1 to
	// resolve the uploads bucket via getBucketByName.
	const demoUser = dev && locals.user.pubkey === DEMO_PUBKEY;
	const db = getDb(platform);
	const uploadsBucket = await getBucketByName(db, 'cadbos-uploads');
	const userId = demoUser ? null : await getUserIdByPubkey(db, locals.user.pubkey);
	if (!demoUser && !userId) return apiError(500, 'account_error', 'Account record not found');

	// Generation source media isn't always a stored upload — render/edit calls
	// can use their prior output (recordGeneration) — so a hash match
	// is only reused when it actually resolves to our own bucket; otherwise
	// this falls through to a normal upload rather than handing back an
	// arbitrary URL as if it were deduped.
	const findExisting = userId
		? async (hash: string) => {
				const mediaId = await findGenerationSourceByHash(db, userId, hash);
				if (!mediaId) return null;
				return (await getMedia(db, mediaId))?.filename ?? null;
			}
		: undefined;

	if (request.headers.get('content-type')?.startsWith('application/json')) {
		const body: unknown = await request.json().catch(() => null);
		const parsed = remoteImageUploadRequestSchema.safeParse(body);
		if (!parsed.success) return apiError(400, 'invalid_url', 'Invalid image URL');

		try {
			const result = await importRemoteImage(
				platform,
				uploadsBucket,
				parsed.data.url,
				url.origin,
				globalThis.fetch,
				findExisting
			);
			if (!userId) return apiError(500, 'account_error', 'Account record not found');
			const media = await getOrCreateMediaByKey(db, uploadsBucket, result.key, result.hash);
			return json({
				image: await mediaAccess(platform, media),
				mime: result.mime,
				size: result.size,
				...(result.dimensions ? { dimensions: result.dimensions } : {})
			});
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
		const existingKey = await findExisting?.(hash);
		const result = existingKey
			? { key: existingKey, mime: normalizedMime, size: bytes.byteLength, hash }
			: await uploadImageBytes(platform, uploadsBucket, bytes, file.type, undefined, hash);
		if (!userId) return apiError(500, 'account_error', 'Account record not found');
		const media = await getOrCreateMediaByKey(db, uploadsBucket, result.key, result.hash);
		return json({
			image: await mediaAccess(platform, media),
			mime: result.mime,
			size: result.size
		});
	} catch (err) {
		console.error('Upload failed:', err);
		return apiError(500, 'upload_failed', 'Upload failed');
	}
};
