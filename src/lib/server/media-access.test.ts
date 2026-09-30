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
import { TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';

const presignS3Object = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/s3', () => ({ presignS3Object }));
// Server-side `resolve()` yields request-relative paths inside a request.
vi.mock('$app/paths', () => ({ resolve: (id: string) => `../${id.slice(1)}` }));

import { mediaAccess, providerMediaBatch } from '$lib/server/media-access';

beforeEach(() => {
	presignS3Object.mockReset().mockResolvedValue('https://signed.example.test/object');
});

it('returns an encoded bucket-qualified key and its stable /api/media link', () => {
	const bucket = {
		id: 2,
		name: 'external:https://images.example.test',
		url: 'https://images.example.test',
		region: 'auto'
	};
	expect(
		mediaAccess({ id: 1, filename: 'shared/name.webp', bucket, checksum: '', size: null })
	).toEqual({
		key: 'external%3Ahttps%3A%2F%2Fimages.example.test/shared/name.webp',
		url: '/api/media/external%3Ahttps%3A%2F%2Fimages.example.test/shared/name.webp'
	});
	expect(presignS3Object).not.toHaveBeenCalled();
});

it('resolves identical object names against their qualified buckets', async () => {
	const db = makeD1();
	db.prepare('INSERT INTO buckets (name, url) VALUES (?, ?)')
		.bind('archive', 'https://archive.example.test')
		.run();
	const uploads = await getBucketByName(db, TEST_S3_BUCKET.name);
	const archive = await getBucketByName(db, 'archive');
	const filename = 'shared/name.webp';
	const uploadsMedia = await getOrCreateMediaByKey(db, uploads, filename, '', null);
	const archiveMedia = await getOrCreateMediaByKey(db, archive, filename, '', null);
	const uploadsKey = mediaKey(uploads.name, filename);
	const archiveKey = mediaKey(archive.name, filename);

	const result = await providerMediaBatch(db, undefined, [uploadsKey, archiveKey]);

	expect(result?.get(uploadsKey)?.media).toEqual(uploadsMedia);
	expect(result?.get(archiveKey)?.media).toEqual(archiveMedia);
	expect(presignS3Object).toHaveBeenCalledTimes(2);
	expect(presignS3Object).toHaveBeenCalledWith(undefined, uploads, filename, 10_800);
	await expect(
		providerMediaBatch(db, undefined, ['missing-bucket/shared/name.webp'])
	).resolves.toBeNull();
	await expect(
		providerMediaBatch(db, undefined, [mediaKey(TEST_S3_BUCKET.name, 'missing/name.webp')])
	).resolves.toBeNull();
});

it('presigns render-service URLs for RENDER_MEDIA_TTL_SECONDS', async () => {
	const db = makeD1();
	const uploads = await getBucketByName(db, TEST_S3_BUCKET.name);
	await getOrCreateMediaByKey(db, uploads, 'a.webp', '', null);
	const platform = { env: { RENDER_MEDIA_TTL_SECONDS: '1200' } } as unknown as App.Platform;

	await providerMediaBatch(db, platform, [mediaKey(uploads.name, 'a.webp')]);

	expect(presignS3Object).toHaveBeenCalledWith(platform, uploads, 'a.webp', 1200);
	await expect(
		providerMediaBatch(
			db,
			{ env: { RENDER_MEDIA_TTL_SECONDS: '604801' } } as unknown as App.Platform,
			[mediaKey(uploads.name, 'a.webp')]
		)
	).rejects.toThrow('RENDER_MEDIA_TTL_SECONDS is invalid');
});
