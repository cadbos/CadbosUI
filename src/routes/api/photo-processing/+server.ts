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
import type { RenderResponse } from '$lib/api/contract';
import { MAX_PROCESSED_PHOTO_SIZE } from '$lib/photo-adjustments';
import { apiError, photoProcessingRequestSchema } from '$lib/server/api';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { getDb } from '$lib/server/db';
import { recordPhotoProcessing } from '$lib/server/generations';
import {
	getBucketByName,
	getMediaByBucketKey,
	getOrCreateMediaByKey,
	parseMediaKey,
	uploadsBucketName
} from '$lib/server/media';
import { mediaAccess } from '$lib/server/media-access';
import { assertSessionOwnedByUser } from '$lib/server/projects';
import { uploadImageBytes } from '$lib/server/uploads';

const PHOTO_PROCESSING_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;

function matchesImageSignature(bytes: Uint8Array, mime: string): boolean {
	if (mime === 'image/png')
		return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
	if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (
		mime === 'image/avif' &&
		bytes.length >= 16 &&
		String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp'
	) {
		const boxLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
		if (boxLength < 16 || boxLength > bytes.length) return false;
		for (let offset = 8; offset + 4 <= boxLength; offset += 4) {
			if (offset === 12) continue;
			const brand = String.fromCharCode(...bytes.subarray(offset, offset + 4));
			if (brand === 'avif' || brand === 'avis') return true;
		}
		return false;
	}
	if (mime === 'image/webp')
		return (
			bytes.length >= 12 &&
			String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
			String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
		);
	return false;
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	const contentLength = Number(request.headers.get('content-length'));
	if (contentLength > MAX_PROCESSED_PHOTO_SIZE + 128 * 1024)
		return apiError(413, 'image_too_large', 'Processed image exceeds the size limit');
	let data: FormData;
	try {
		data = await request.formData();
	} catch {
		return apiError(400, 'invalid_request', 'Expected photo processing form data');
	}
	const file = data.get('file');
	if (!(file instanceof File) || file.size === 0)
		return apiError(400, 'invalid_request', 'Expected a processed image');
	if (file.size > MAX_PROCESSED_PHOTO_SIZE)
		return apiError(413, 'image_too_large', 'Processed image exceeds the size limit');
	let snapshot: unknown;
	try {
		const raw = data.get('formSnapshot');
		if (typeof raw !== 'string' || raw.length > 128 * 1024)
			return apiError(400, 'invalid_request', 'Invalid processing settings');
		snapshot = JSON.parse(raw);
	} catch {
		return apiError(400, 'invalid_request', 'Invalid processing settings');
	}
	const parsed = photoProcessingRequestSchema.safeParse({
		imageKey: data.get('imageKey'),
		sessionId: data.get('sessionId'),
		formSnapshot: snapshot
	});
	if (!parsed.success) return apiError(400, 'invalid_request', 'Invalid processing settings');
	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');
	if (
		await touchRateLimit(
			db,
			`photo-processing:${locals.user.pubkey}`,
			Date.now(),
			PHOTO_PROCESSING_RATE_LIMIT
		)
	)
		return apiError(429, 'rate_limited', 'Too many requests');
	if (!(await assertSessionOwnedByUser(db, userId, parsed.data.sessionId)))
		return apiError(404, 'session_not_found', 'Session not found');
	const key = parseMediaKey(parsed.data.imageKey);
	const source = key ? await getMediaByBucketKey(db, key.bucketName, key.filename) : null;
	if (!source) return apiError(404, 'image_not_found', 'Image not found');
	const bytes = await file.arrayBuffer();
	if (!matchesImageSignature(new Uint8Array(bytes), file.type))
		return apiError(415, 'unsupported_image_type', 'Unsupported processed image type');
	try {
		const bucket = await getBucketByName(db, uploadsBucketName(platform));
		const stored = await uploadImageBytes(platform, bucket, bytes, file.type);
		const output = await getOrCreateMediaByKey(db, bucket, stored.key, stored.hash, stored.size);
		const recorded = await recordPhotoProcessing(db, userId, {
			resultMediaId: output.id,
			sourceMediaId: source.id,
			sessionId: parsed.data.sessionId,
			formSnapshot: parsed.data.formSnapshot
		});
		return json({
			id: recorded.id,
			output: mediaAccess(output),
			cost: 0,
			balance: recorded.balance
		} satisfies RenderResponse);
	} catch (error) {
		console.error(
			'Photo processing save failed:',
			error instanceof Error ? error.name : typeof error
		);
		return apiError(500, 'photo_processing_failed', 'Could not save the processed photo');
	}
};
