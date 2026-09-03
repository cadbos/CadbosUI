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

import { describe, expect, it } from 'vitest';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	getBucketByName,
	getOrCreateMediaByKey,
	getMedia,
	getMediaBatch,
	getMediaByBucketKey,
	mediaKey,
	parseMediaKey
} from '$lib/server/media';

describe('media repository', () => {
	it('stores and resolves managed bearer keys', async () => {
		const db = makeD1();
		const bucket = await getBucketByName(db, 'cadbos-uploads');

		const created = await getOrCreateMediaByKey(
			db,
			bucket,
			'rooms/with space.webp',
			'A'.repeat(64)
		);
		const reused = await getOrCreateMediaByKey(db, bucket, 'rooms/with space.webp', 'a'.repeat(64));

		expect(reused.id).toBe(created.id);
		expect(created).toMatchObject({ filename: 'rooms/with space.webp', checksum: 'a'.repeat(64) });
		await expect(getMedia(db, created.id)).resolves.toMatchObject({
			id: created.id,
			filename: 'rooms/with space.webp',
			bucket
		});
		await expect(getMediaByBucketKey(db, bucket.name, 'rooms/with space.webp')).resolves.toEqual(
			created
		);
		await expect(getMediaByBucketKey(db, bucket.name, 'missing.webp')).resolves.toBeNull();
	});

	it('composes and resolves bucket-qualified keys without splitting object paths', async () => {
		const db = makeD1();
		db.prepare('INSERT INTO buckets (name, url) VALUES (?, ?)')
			.bind('external:https://images.example.test', 'https://images.example.test')
			.run();
		const uploads = await getBucketByName(db, 'cadbos-uploads');
		const external = await getBucketByName(db, 'external:https://images.example.test');
		const filename = 'rooms/shared/name.webp';
		const uploadsMedia = await getOrCreateMediaByKey(db, uploads, filename, '');
		const externalMedia = await getOrCreateMediaByKey(db, external, filename, '');
		const uploadsKey = mediaKey(uploads.name, filename);
		const externalKey = mediaKey(external.name, filename);

		expect(uploadsKey).toBe('cadbos-uploads/rooms/shared/name.webp');
		expect(externalKey).toBe('external%3Ahttps%3A%2F%2Fimages.example.test/rooms/shared/name.webp');
		expect(parseMediaKey(externalKey)).toEqual({ bucketName: external.name, filename });
		await expect(getMediaByBucketKey(db, uploads.name, filename)).resolves.toEqual(uploadsMedia);
		await expect(getMediaByBucketKey(db, external.name, filename)).resolves.toEqual(externalMedia);
	});

	it('rejects malformed and non-canonical media keys', () => {
		expect(parseMediaKey('object.webp')).toBeNull();
		expect(parseMediaKey('bucket/')).toBeNull();
		expect(parseMediaKey('%invalid/object.webp')).toBeNull();
		expect(parseMediaKey('external%3ahttps%3a%2f%2fexample.test/object.webp')).toBeNull();
		expect(parseMediaKey('bucket//nested/object.webp')).toEqual({
			bucketName: 'bucket',
			filename: '/nested/object.webp'
		});
	});

	it('loads batches of 100 media without exceeding D1 parameter limits', async () => {
		const db = makeD1();
		const bucket = await getBucketByName(db, 'cadbos-uploads');
		const media = await Promise.all(
			Array.from({ length: 100 }, (_, index) =>
				getOrCreateMediaByKey(db, bucket, `batch/${index}.webp`, '')
			)
		);

		const result = await getMediaBatch(db, media.map((item) => item.id).reverse());

		expect(result).toHaveLength(100);
		expect(result.map((item) => item.id)).toEqual(
			media.map((item) => item.id).sort((left, right) => left - right)
		);
	});
});
