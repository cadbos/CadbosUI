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
import type {
	GeneratedImageDetailResponse,
	ImageInput,
	ManagedImageInput,
	MediaAccess,
	RequestFormSnapshot
} from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { getGenerationDetailForUser } from '$lib/server/generations';
import { mediaAccessById, mediaAccessByKeyBatch } from '$lib/server/media-access';

// Only the ManagedImageInput variant (a stylePresetId reference has no media
// of its own to resolve — it's a built-in preset, not an upload).
function referencedMediaKeys(snapshot: RequestFormSnapshot): string[] {
	const images: (ImageInput | undefined)[] = [
		snapshot.styleReferenceImage,
		snapshot.objectReferenceImage,
		snapshot.textureReferenceImage,
		snapshot.textureMaskImage
	];
	return images
		.filter((image): image is ManagedImageInput => image !== undefined && 'mediaKey' in image)
		.map((image) => image.mediaKey);
}

// A reference/mask image the snapshot points to may since have been deleted —
// drop just that field rather than the whole snapshot, so the rest of the
// restored settings (prompt, sceneType, etc.) still come back.
function withAvailableReferenceImages(
	snapshot: RequestFormSnapshot,
	referencedAccess: Map<string, MediaAccess>
): RequestFormSnapshot {
	const isAvailable = (image: ImageInput | undefined): boolean =>
		image === undefined || !('mediaKey' in image) || referencedAccess.has(image.mediaKey);
	return {
		...snapshot,
		styleReferenceImage: isAvailable(snapshot.styleReferenceImage)
			? snapshot.styleReferenceImage
			: undefined,
		objectReferenceImage: isAvailable(snapshot.objectReferenceImage)
			? snapshot.objectReferenceImage
			: undefined,
		textureReferenceImage: isAvailable(snapshot.textureReferenceImage)
			? snapshot.textureReferenceImage
			: undefined,
		textureMaskImage: isAvailable(snapshot.textureMaskImage) ? snapshot.textureMaskImage : undefined
	};
}

export const GET: RequestHandler = async ({ params, platform, locals }) => {
	if (!locals.user) {
		return authenticationRequiredResponse(locals.sessionLookupUnavailable);
	}
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}

	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, locals.user.pubkey);
	if (!userId) return apiError(500, 'account_error', 'Account record not found');

	const detail = await getGenerationDetailForUser(db, userId, params.id);
	if (!detail) return apiError(404, 'generation_not_found', 'Generation not found');

	const [image, source] = await Promise.all([
		mediaAccessById(db, platform, detail.resultMediaId),
		mediaAccessById(db, platform, detail.sourceMediaId)
	]);
	if (!image || !source) return apiError(404, 'image_not_found', 'Image not found');

	const referencedKeys = detail.formSnapshot ? referencedMediaKeys(detail.formSnapshot) : [];
	const referencedAccess = referencedKeys.length
		? await mediaAccessByKeyBatch(db, platform, referencedKeys)
		: new Map<string, MediaAccess>();
	const formSnapshot = detail.formSnapshot
		? withAvailableReferenceImages(detail.formSnapshot, referencedAccess)
		: null;

	return json(
		{
			id: detail.id,
			prompt: detail.prompt,
			kind: detail.kind,
			createdAt: detail.createdAt,
			image,
			source,
			formSnapshot,
			media: [image, source, ...referencedAccess.values()]
		} satisfies GeneratedImageDetailResponse,
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
