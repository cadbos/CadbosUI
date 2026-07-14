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
import { MAX_IMAGE_UPLOAD_SIZE } from '$lib/server/remote-image';
import { POST } from './+server';

type UploadEvent = Parameters<typeof POST>[0];

function platform(bucket = { put: vi.fn(async () => undefined) }): App.Platform {
	return {
		env: {
			UPLOADS_BUCKET: bucket,
			UPLOADS_PUBLIC_URL: 'https://uploads.cadbos.example'
		}
	} as unknown as App.Platform;
}

function call(body: unknown, uploadPlatform = platform()): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/uploads', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		platform: uploadPlatform,
		url: new URL('https://cadbos.example/api/uploads')
	} as UploadEvent);
}

describe('POST /api/uploads remote import', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('imports a valid HTTPS URL through the R2 upload path', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('image-bytes', { headers: { 'content-type': 'image/webp' } })
		);

		const response = await call({ url: 'https://images.example.com/room.webp' });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			url: expect.stringMatching(/^https:\/\/uploads\.cadbos\.example\//),
			mime: 'image/webp',
			size: 11
		});
	});

	it('rejects a non-HTTPS URL without fetching it', async () => {
		const fetch = vi.spyOn(globalThis, 'fetch');

		const response = await call({ url: 'http://images.example.com/room.webp' });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: 'invalid_url', message: 'Invalid image URL' }
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('returns 415 for an unsupported remote image type', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('not-an-image', { headers: { 'content-type': 'text/html' } })
		);

		const response = await call({ url: 'https://images.example.com/room.jpg' });

		expect(response.status).toBe(415);
		expect(await response.json()).toEqual({
			error: { code: 'unsupported_image_type', message: 'Unsupported image type' }
		});
	});

	it('returns 413 for an oversized remote image', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('image-bytes', {
				headers: {
					'content-type': 'image/jpeg',
					'content-length': String(MAX_IMAGE_UPLOAD_SIZE + 1)
				}
			})
		);

		const response = await call({ url: 'https://images.example.com/room.jpg' });

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: { code: 'image_too_large', message: 'Image exceeds the 8 MB limit' }
		});
	});

	it('returns 502 when fetching the remote image fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network error'));

		const response = await call({ url: 'https://images.example.com/room.jpg' });

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: { code: 'remote_fetch_failed', message: 'Failed to fetch image' }
		});
	});

	it('returns 500 for an unrecognized remote import error', async () => {
		const bucket = { put: vi.fn().mockRejectedValue(new Error('R2 write failed')) };
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('image-bytes', { headers: { 'content-type': 'image/jpeg' } })
		);

		const response = await call({ url: 'https://images.example.com/room.jpg' }, platform(bucket));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: { code: 'upload_failed', message: 'Upload failed' }
		});
	});
});
