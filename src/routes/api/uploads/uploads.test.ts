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
import type { SessionUser } from '$lib/api/contract';
import { DEMO_PUBKEY } from '$lib/server/demo';
import type { Bucket } from '$lib/server/media';
import { MAX_IMAGE_UPLOAD_SIZE } from '$lib/server/remote-image';
import { makeD1 } from '$lib/server/testing/d1-shim';
import { seedGeneration, setBucketUrl, TEST_S3_ENV } from '$lib/server/testing/generation-fixtures';

const storage = vi.hoisted(() => ({
	putS3Object:
		vi.fn<
			(
				platform: App.Platform | undefined,
				bucket: Bucket,
				key: string,
				bytes: ArrayBuffer,
				mime: string
			) => Promise<void>
		>()
}));

vi.mock('$lib/server/s3', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/s3')>()),
	putS3Object: storage.putS3Object
}));

import { POST } from './+server';

type UploadEvent = Parameters<typeof POST>[0];

const UPLOADS_URL = 'https://uploads.cadbos.example';
function platform(
	bucket = {
		put: vi.fn(async (_key: string, _bytes: ArrayBuffer, _metadata: unknown) => undefined)
	},
	db = makeD1()
): App.Platform {
	setBucketUrl(db, 'cadbos-uploads', UPLOADS_URL);
	storage.putS3Object.mockImplementation(async (_platform, _bucket, key, bytes, mime) => {
		await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
	});
	return {
		env: {
			DB: db,
			...TEST_S3_ENV
		}
	} as unknown as App.Platform;
}

// Demo requests still use D1 for the canonical uploads URL, but skip account
// lookup and deduplication.
function call(
	body: unknown,
	uploadPlatform = platform(),
	user: SessionUser | null = { pubkey: DEMO_PUBKEY }
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/uploads', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		platform: uploadPlatform,
		url: new URL('https://cadbos.example/api/uploads'),
		locals: { sessionLookupUnavailable: false, user }
	} as UploadEvent);
}

function seedUser(db: ReturnType<typeof makeD1>, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

function seedGenerationWithSource(
	db: ReturnType<typeof makeD1>,
	id: string,
	userId: string,
	sourceUrl: string,
	sourceHash: string
): void {
	if (sourceUrl.startsWith(UPLOADS_URL)) {
		setBucketUrl(db, 'cadbos-uploads', UPLOADS_URL);
	}
	seedGeneration(db, {
		id,
		userId,
		url: `https://cdn.example.test/${id}.webp`,
		sourceUrl,
		sourceChecksum: sourceHash,
		createdAt: Date.now()
	});
}

async function sha256Hex(bytes: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bytes));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

describe('POST /api/uploads remote import', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it('imports a valid HTTPS URL through the S3 upload path', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('image-bytes', { headers: { 'content-type': 'image/webp' } })
		);

		const response = await call(
			{ url: 'https://images.example.com/room.webp' },
			platform(undefined, db),
			{ pubkey: 'pubkey-1' }
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			image: {
				key: expect.any(String),
				url: expect.stringContaining('?')
			},
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
		const bucket = { put: vi.fn().mockRejectedValue(new Error('S3 write failed')) };
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

describe('POST /api/uploads auth', () => {
	it('returns 401 when the request has no authenticated user', async () => {
		const response = await call({ url: 'https://images.example.com/room.webp' }, platform(), null);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: { code: 'unauthorized', message: 'Authentication required' }
		});
	});
});

describe('POST /api/uploads dedup (non-demo, D1-backed)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reuses an existing stored-upload source_url instead of writing to S3', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const hash = await sha256Hex('image-bytes');
		seedGenerationWithSource(db, 'a', 'user-1', `${UPLOADS_URL}/existing.webp`, hash);
		const bucket = { put: vi.fn(async () => undefined) };
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('image-bytes', { headers: { 'content-type': 'image/webp' } })
		);

		const response = await call(
			{ url: 'https://images.example.com/room.webp' },
			platform(bucket, db),
			{ pubkey: 'pubkey-1' }
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			image: {
				key: 'cadbos-uploads/existing.webp',
				url: expect.stringContaining('/existing.webp?')
			}
		});
		expect(bucket.put).not.toHaveBeenCalled();
	});

	it('does not reuse a matching-hash source_url that points outside the uploads bucket', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', 'pubkey-1');
		const hash = await sha256Hex('image-bytes');
		// A render/edit call can use generation output media as its source,
		// so a hash match here isn't necessarily a stored upload — reusing it as
		// one would hand back an arbitrary, attacker-influenced URL.
		seedGenerationWithSource(
			db,
			'a',
			'user-1',
			'https://render-provider.example/output.webp',
			hash
		);
		const bucket = { put: vi.fn(async () => undefined) };
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('image-bytes', { headers: { 'content-type': 'image/webp' } })
		);

		const response = await call(
			{ url: 'https://images.example.com/room.webp' },
			platform(bucket, db),
			{ pubkey: 'pubkey-1' }
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			image: {
				key: expect.any(String),
				url: expect.stringContaining('?')
			}
		});
		expect(bucket.put).toHaveBeenCalledTimes(1);
	});
});
