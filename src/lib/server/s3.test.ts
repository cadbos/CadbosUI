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
import type { Bucket } from '$lib/server/media';
import { TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';
import { deleteS3Object, isS3BucketAvailable, presignS3Object, putS3Object } from './s3';

function platform(overrides: Partial<App.Platform['env']> = {}): App.Platform {
	return {
		env: {
			S3_ACCESS_KEY_ID: 'access-key',
			S3_SECRET_ACCESS_KEY: 'secret-key',
			...overrides
		}
	} as unknown as App.Platform;
}

function bucket(overrides: Partial<Bucket> = {}): Bucket {
	return { ...TEST_S3_BUCKET, region: 'eu-test-1', ...overrides };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('S3 storage', () => {
	it('uses the bucket-scoped endpoint for upload, delete, and health checks', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 200 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));
		vi.stubGlobal('fetch', fetcher);
		const bytes = new TextEncoder().encode('image').buffer;
		const requestPlatform = platform();
		const requestBucket = bucket();

		await putS3Object(requestPlatform, requestBucket, 'jobs/image.png', bytes, 'image/png');
		await deleteS3Object(requestPlatform, requestBucket, 'jobs/image.png');
		await expect(isS3BucketAvailable(requestPlatform, requestBucket)).resolves.toBe(true);

		expect(fetcher).toHaveBeenNthCalledWith(
			1,
			'https://s3.example.test/cadbos/jobs/image.png',
			expect.objectContaining({
				method: 'PUT',
				body: expect.any(Uint8Array),
				headers: expect.objectContaining({ 'content-type': 'image/png' })
			})
		);
		expect(fetcher).toHaveBeenNthCalledWith(
			2,
			'https://s3.example.test/cadbos/jobs/image.png',
			expect.objectContaining({ method: 'DELETE' })
		);
		expect(fetcher).toHaveBeenNthCalledWith(
			3,
			'https://s3.example.test/cadbos',
			expect.objectContaining({ method: 'HEAD' })
		);
	});

	it('rejects unsafe endpoints and sanitizes provider failures', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response('<Error><Message>private provider detail</Message></Error>', {
				status: 500,
				headers: { 'content-type': 'application/xml' }
			})
		);
		vi.stubGlobal('fetch', fetcher);

		const failure = await putS3Object(
			platform(),
			bucket(),
			'image.png',
			new ArrayBuffer(1),
			'image/png'
		).catch((error: unknown) => error);
		expect(failure).toEqual(new Error('S3 upload failed with status 500 (S3ServiceError)'));
		expect((failure as Error).message).not.toContain('private provider detail');
		await expect(
			putS3Object(
				platform(),
				bucket({ url: 'http://s3.example.test/cadbos' }),
				'image.png',
				new ArrayBuffer(1),
				'image/png'
			)
		).rejects.toThrow('bucket cadbos-uploads URL is invalid');
		await expect(isS3BucketAvailable(platform(), bucket({ region: ' auto' }))).rejects.toThrow(
			'bucket cadbos-uploads region is invalid'
		);
	});

	it('presigns reads with purpose defaults and configured lifetimes', async () => {
		const requestPlatform = platform();
		const ui = await presignS3Object(requestPlatform, bucket(), 'rooms/a b/рисунок.webp', 'ui');
		const provider = await presignS3Object(
			requestPlatform,
			bucket(),
			'rooms/a b/рисунок.webp',
			'provider'
		);

		expect(new URL(ui).searchParams.get('X-Amz-Expires')).toBe('43200');
		expect(new URL(provider).searchParams.get('X-Amz-Expires')).toBe('10800');
		const configured = await presignS3Object(
			platform({ S3_PRESIGNED_PROVIDER_TTL_SECONDS: '1200' }),
			bucket(),
			'rooms/a b/рисунок.webp',
			'provider'
		);
		expect(new URL(configured).searchParams.get('X-Amz-Expires')).toBe('1200');
		expect(new URL(ui).pathname).toBe(
			'/cadbos/rooms/a%20b/%D1%80%D0%B8%D1%81%D1%83%D0%BD%D0%BE%D0%BA.webp'
		);
	});

	it.each(['0', '-1', '1.5', ' 300', '604801', '9007199254740992'])(
		'rejects invalid presigned TTL %s and fails the health check closed',
		async (value) => {
			const requestPlatform = platform({
				S3_PRESIGNED_UI_TTL_SECONDS: value
			});

			await expect(presignS3Object(requestPlatform, bucket(), 'image.png', 'ui')).rejects.toThrow(
				'S3_PRESIGNED_UI_TTL_SECONDS is invalid'
			);
			await expect(isS3BucketAvailable(requestPlatform, bucket())).rejects.toThrow(
				'S3_PRESIGNED_UI_TTL_SECONDS is invalid'
			);
		}
	);
});
