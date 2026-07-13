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
import {
	MAX_IMAGE_UPLOAD_SIZE,
	RemoteImageImportError,
	importRemoteImage,
	validateRemoteImageUrl
} from './remote-image';

function platform(bucket: { put: ReturnType<typeof vi.fn> }): App.Platform {
	return {
		env: {
			UPLOADS_BUCKET: bucket,
			UPLOADS_PUBLIC_URL: 'https://uploads.cadbos.example'
		}
	} as unknown as App.Platform;
}

function imageResponse(contentType: string, body: BodyInit): Response {
	return new Response(body, { headers: { 'content-type': contentType } });
}

describe('remote image import', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('downloads an image and stores it through the existing R2 adapter', async () => {
		const bucket = { put: vi.fn(async () => undefined) };
		const id = '123e4567-e89b-12d3-a456-426614174003' as ReturnType<typeof crypto.randomUUID>;
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
		const fetcher = vi.fn(async () => imageResponse('image/png', 'image-bytes'));

		const result = await importRemoteImage(
			platform(bucket),
			'https://images.example.com/room.png',
			'https://cadbos.example',
			fetcher as typeof fetch
		);

		expect(fetcher).toHaveBeenCalledWith(new URL('https://images.example.com/room.png'), {
			headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
			redirect: 'manual',
			signal: expect.any(AbortSignal)
		});
		expect(bucket.put).toHaveBeenCalledWith(`${id}.png`, expect.any(ArrayBuffer), {
			httpMetadata: { contentType: 'image/png' }
		});
		expect(result).toEqual({
			url: `https://uploads.cadbos.example/${id}.png`,
			mime: 'image/png',
			size: 11
		});
	});

	it('revalidates every redirect destination', async () => {
		const bucket = { put: vi.fn(async () => undefined) };
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: 'https://cdn.example.com/room.webp' }
				})
			)
			.mockResolvedValueOnce(imageResponse('image/webp', 'image-bytes'));

		await importRemoteImage(
			platform(bucket),
			'https://images.example.com/room.webp',
			'https://cadbos.example',
			fetcher as typeof fetch
		);

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher.mock.calls[1]?.[0]).toEqual(new URL('https://cdn.example.com/room.webp'));
	});

	it.each([
		'https://cadbos.example/room.jpg',
		'http://images.example.com/room.jpg',
		'https://user:password@images.example.com/room.jpg',
		'https://127.0.0.1/room.jpg',
		'https://localhost/room.jpg',
		'https://images.example.com:8443/room.jpg'
	])('rejects unsafe URL %s before fetching', async (url) => {
		const fetcher = vi.fn();

		await expect(
			importRemoteImage(
				platform({ put: vi.fn(async () => undefined) }),
				url,
				'https://cadbos.example',
				fetcher as typeof fetch
			)
		).rejects.toMatchObject({ code: 'invalid_url' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('rejects unsupported content types', async () => {
		await expect(
			importRemoteImage(
				platform({ put: vi.fn(async () => undefined) }),
				'https://images.example.com/room.jpg',
				'https://cadbos.example',
				vi.fn(async () => imageResponse('text/html', 'not-an-image')) as typeof fetch
			)
		).rejects.toMatchObject({ code: 'unsupported_image_type' });
	});

	it('rejects an image body that exceeds the upload limit while streaming', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(MAX_IMAGE_UPLOAD_SIZE));
				controller.enqueue(new Uint8Array(1));
				controller.close();
			}
		});

		await expect(
			importRemoteImage(
				platform({ put: vi.fn(async () => undefined) }),
				'https://images.example.com/room.jpg',
				'https://cadbos.example',
				vi.fn(async () => imageResponse('image/jpeg', stream)) as typeof fetch
			)
		).rejects.toMatchObject({ code: 'image_too_large' });
	});

	it('normalizes URL parsing before validating the target', () => {
		expect(() =>
			validateRemoteImageUrl('https://2130706433/room.jpg', 'https://cadbos.example')
		).toThrow(RemoteImageImportError);
	});
});
