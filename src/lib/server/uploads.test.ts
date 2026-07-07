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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadImage, uploadImageBytes } from './uploads';

function mockBucket(): { put: ReturnType<typeof vi.fn> } {
	return { put: vi.fn(async () => undefined) };
}

function platform(bucket: ReturnType<typeof mockBucket>, publicUrl?: string): App.Platform {
	return {
		env: {
			UPLOADS_BUCKET: bucket,
			UPLOADS_PUBLIC_URL: publicUrl
		}
	} as unknown as App.Platform;
}

describe('uploadImage', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('stores the file and returns the public object URL', async () => {
		const bucket = mockBucket();
		const id = '123e4567-e89b-12d3-a456-426614174000' as ReturnType<typeof crypto.randomUUID>;
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);

		const file = new File(['image-bytes'], 'room.jpg', { type: 'image/jpeg' });
		const result = await uploadImage(platform(bucket, 'https://uploads.cadbos.example'), file);

		expect(bucket.put).toHaveBeenCalledWith(`${id}.jpg`, expect.any(ArrayBuffer), {
			httpMetadata: { contentType: 'image/jpeg' }
		});
		expect(result).toEqual({
			url: `https://uploads.cadbos.example/${id}.jpg`,
			mime: 'image/jpeg',
			size: file.size
		});
	});

	it('requires a public upload base URL when storage is configured', async () => {
		const file = new File(['image-bytes'], 'room.jpg', { type: 'image/jpeg' });

		await expect(uploadImage(platform(mockBucket()), file)).rejects.toThrow(
			'UPLOADS_PUBLIC_URL not configured'
		);
	});

	it('stores generated image bytes and returns the public object URL', async () => {
		const bucket = mockBucket();
		const id = '123e4567-e89b-12d3-a456-426614174001' as ReturnType<typeof crypto.randomUUID>;
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);

		const bytes = await new Blob(['generated-image']).arrayBuffer();
		const result = await uploadImageBytes(
			platform(bucket, 'https://uploads.cadbos.example'),
			bytes,
			'image/webp'
		);

		expect(bucket.put).toHaveBeenCalledWith(`${id}.webp`, bytes, {
			httpMetadata: { contentType: 'image/webp' }
		});
		expect(result).toEqual({
			url: `https://uploads.cadbos.example/${id}.webp`,
			mime: 'image/webp',
			size: bytes.byteLength
		});
	});

	it('normalizes parameterized image content types before storing and returning metadata', async () => {
		const bucket = mockBucket();
		const id = '123e4567-e89b-12d3-a456-426614174002' as ReturnType<typeof crypto.randomUUID>;
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);

		const bytes = await new Blob(['generated-image']).arrayBuffer();
		const result = await uploadImageBytes(
			platform(bucket, 'https://uploads.cadbos.example'),
			bytes,
			'image/jpeg; charset=binary'
		);

		expect(bucket.put).toHaveBeenCalledWith(`${id}.jpg`, bytes, {
			httpMetadata: { contentType: 'image/jpeg' }
		});
		expect(result).toEqual({
			url: `https://uploads.cadbos.example/${id}.jpg`,
			mime: 'image/jpeg',
			size: bytes.byteLength
		});
	});
});
