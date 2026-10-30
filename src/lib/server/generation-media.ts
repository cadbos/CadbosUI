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

import type {
	ImageInput,
	ManagedImageInput,
	MediaAccess,
	RequestFormSnapshot
} from '$lib/api/contract';
import type { Database } from '$lib/server/db';
import { mediaAccessById, mediaAccessByKeyBatch } from '$lib/server/media-access';

interface GenerationMediaInput {
	resultMediaId: number;
	sourceMediaId: number;
	referenceMediaId?: number | null;
	formSnapshot: RequestFormSnapshot | null;
}

interface GenerationMedia {
	image: MediaAccess | null;
	source: MediaAccess | null;
	reference: MediaAccess | null;
	referencedAccess: Map<string, MediaAccess>;
	media: MediaAccess[];
}

export async function resolveGenerationMedia(
	db: Database,
	detail: GenerationMediaInput
): Promise<GenerationMedia> {
	const snapshot = detail.formSnapshot;
	const images: (ImageInput | undefined)[] = snapshot
		? [
				snapshot.styleReferenceImage,
				snapshot.objectReferenceImage,
				snapshot.textureReferenceImage,
				snapshot.textureMaskImage
			]
		: [];
	const keys = images
		.filter((image): image is ManagedImageInput => image !== undefined && 'mediaKey' in image)
		.map((image) => image.mediaKey);
	const [image, source, reference, referencedAccess] = await Promise.all([
		mediaAccessById(db, detail.resultMediaId),
		mediaAccessById(db, detail.sourceMediaId),
		detail.referenceMediaId == null ? null : mediaAccessById(db, detail.referenceMediaId),
		mediaAccessByKeyBatch(db, keys)
	]);
	const media = new Map<string, MediaAccess>();
	for (const access of [image, source, reference, ...referencedAccess.values()]) {
		if (access) media.set(access.key, access);
	}
	return { image, source, reference, referencedAccess, media: [...media.values()] };
}

export function withAvailableReferenceImages(
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
