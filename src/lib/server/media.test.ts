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
import { TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';
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
		const bucket = await getBucketByName(db, TEST_S3_BUCKET.name);

		const created = await getOrCreateMediaByKey(
			db,
			bucket,
			'rooms/with space.webp',
			'A'.repeat(64),
			null
		);
		const reused = await getOrCreateMediaByKey(
			db,
			bucket,
			'rooms/with space.webp',
			'a'.repeat(64),
			null
		);

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
		const uploads = await getBucketByName(db, TEST_S3_BUCKET.name);
		const external = await getBucketByName(db, 'external:https://images.example.test');
		const filename = 'rooms/shared/name.webp';
		const uploadsMedia = await getOrCreateMediaByKey(db, uploads, filename, '', null);
		const externalMedia = await getOrCreateMediaByKey(db, external, filename, '', null);
		const uploadsKey = mediaKey(uploads.name, filename);
		const externalKey = mediaKey(external.name, filename);

		expect(uploadsKey).toBe(mediaKey(TEST_S3_BUCKET.name, filename));
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
		const bucket = await getBucketByName(db, TEST_S3_BUCKET.name);
		const media = await Promise.all(
			Array.from({ length: 100 }, (_, index) =>
				getOrCreateMediaByKey(db, bucket, `batch/${index}.webp`, '', null)
			)
		);

		const result = await getMediaBatch(db, media.map((item) => item.id).reverse());

		expect(result).toHaveLength(100);
		expect(result.map((item) => item.id)).toEqual(
			media.map((item) => item.id).sort((left, right) => left - right)
		);
	});

	it('stores the byte size and returns it from every reader', async () => {
		const db = makeD1();
		const bucket = await getBucketByName(db, TEST_S3_BUCKET.name);

		const created = await getOrCreateMediaByKey(db, bucket, 'sized.webp', '', 342_000);

		expect(created.size).toBe(342_000);
		await expect(getMedia(db, created.id)).resolves.toMatchObject({ size: 342_000 });
		await expect(getMediaBatch(db, [created.id])).resolves.toMatchObject([{ size: 342_000 }]);
		await expect(getMediaByBucketKey(db, bucket.name, 'sized.webp')).resolves.toMatchObject({
			size: 342_000
		});
	});

	it('keeps an unknown size as null rather than zero', async () => {
		const db = makeD1();
		const bucket = await getBucketByName(db, TEST_S3_BUCKET.name);

		const created = await getOrCreateMediaByKey(db, bucket, 'unknown.webp', '', null);

		expect(created.size).toBeNull();
		await expect(getMedia(db, created.id)).resolves.toMatchObject({ size: null });
	});

	it('fills a missing size on reuse but never overwrites a known one', async () => {
		const db = makeD1();
		const bucket = await getBucketByName(db, TEST_S3_BUCKET.name);
		const legacy = await getOrCreateMediaByKey(db, bucket, 'legacy.webp', '', null);

		const filled = await getOrCreateMediaByKey(db, bucket, 'legacy.webp', '', 1_024);
		const kept = await getOrCreateMediaByKey(db, bucket, 'legacy.webp', '', 2_048);
		const unchanged = await getOrCreateMediaByKey(db, bucket, 'legacy.webp', '', null);

		expect([filled.id, kept.id, unchanged.id]).toEqual([legacy.id, legacy.id, legacy.id]);
		expect(filled.size).toBe(1_024);
		expect(kept.size).toBe(1_024);
		expect(unchanged.size).toBe(1_024);
		await expect(getMedia(db, legacy.id)).resolves.toMatchObject({ size: 1_024 });
	});

	it('rejects a negative size', async () => {
		const db = makeD1();
		const bucket = await getBucketByName(db, TEST_S3_BUCKET.name);

		await expect(getOrCreateMediaByKey(db, bucket, 'negative.webp', '', -1)).rejects.toThrow();
	});
});
