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

import { beforeEach, expect, it, vi } from 'vitest';
import { getBucketByName, getOrCreateMediaByKey, mediaKey } from '$lib/server/media';
import { makeD1 } from '$lib/server/testing/d1-shim';

const presignS3Object = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/s3', () => ({ presignS3Object }));

import { mediaAccess, providerMediaBatch } from '$lib/server/media-access';

beforeEach(() => {
	presignS3Object.mockReset().mockResolvedValue('https://signed.example.test/object');
});

it('returns an encoded bucket-qualified key for any stored bucket', async () => {
	const bucket = {
		id: 2,
		name: 'external:https://images.example.test',
		url: 'https://images.example.test',
		region: 'auto'
	};
	await expect(
		mediaAccess(undefined, {
			id: 1,
			filename: 'shared/name.webp',
			bucket,
			checksum: ''
		})
	).resolves.toEqual({
		key: 'external%3Ahttps%3A%2F%2Fimages.example.test/shared/name.webp',
		url: 'https://signed.example.test/object'
	});
	expect(presignS3Object).toHaveBeenCalledWith(undefined, bucket, 'shared/name.webp', 'ui');
});

it('resolves identical object names against their qualified buckets', async () => {
	const db = makeD1();
	db.prepare('INSERT INTO buckets (name, url) VALUES (?, ?)')
		.bind('archive', 'https://archive.example.test')
		.run();
	const uploads = await getBucketByName(db, 'cadbos-uploads');
	const archive = await getBucketByName(db, 'archive');
	const filename = 'shared/name.webp';
	const uploadsMedia = await getOrCreateMediaByKey(db, uploads, filename, '');
	const archiveMedia = await getOrCreateMediaByKey(db, archive, filename, '');
	const uploadsKey = mediaKey(uploads.name, filename);
	const archiveKey = mediaKey(archive.name, filename);

	const result = await providerMediaBatch(db, undefined, [uploadsKey, archiveKey]);

	expect(result?.get(uploadsKey)?.media).toEqual(uploadsMedia);
	expect(result?.get(archiveKey)?.media).toEqual(archiveMedia);
	expect(presignS3Object).toHaveBeenCalledTimes(2);
	await expect(
		providerMediaBatch(db, undefined, ['missing-bucket/shared/name.webp'])
	).resolves.toBeNull();
	await expect(
		providerMediaBatch(db, undefined, ['cadbos-uploads/missing/name.webp'])
	).resolves.toBeNull();
});
