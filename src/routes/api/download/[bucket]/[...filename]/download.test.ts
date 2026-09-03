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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { getBucketByName, getOrCreateMediaByKey } from '$lib/server/media';
import { makeD1 } from '$lib/server/testing/d1-shim';

const presignS3Object = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/s3', () => ({ presignS3Object }));

import { GET } from './+server';

type DownloadEvent = Parameters<typeof GET>[0];

function platform(db: D1Database): App.Platform {
	return { env: { DB: db } } as unknown as App.Platform;
}

function call(
	db: D1Database,
	bucket: string,
	filename: string,
	fetch: typeof globalThis.fetch
): ReturnType<typeof GET> {
	return GET({
		fetch,
		locals: { sessionLookupUnavailable: false, user: null },
		params: { bucket, filename },
		platform: platform(db),
		url: new URL(`https://cadbos.example/api/download/${bucket}/${filename}`)
	} as DownloadEvent);
}

beforeEach(() => {
	presignS3Object.mockReset().mockResolvedValue('https://signed.example.test/image');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/download/<bucket>/<filename>', () => {
	it('streams registered media without authentication', async () => {
		const db = makeD1();
		const bucket = await getBucketByName(db, 'cadbos-uploads');
		await getOrCreateMediaByKey(db, bucket, 'rooms/result.webp', '');
		const fetch = vi.fn(
			async () =>
				new Response('image-bytes', {
					headers: { 'content-type': 'image/webp; charset=binary' }
				})
		);

		const response = await call(db, bucket.name, 'rooms/result.webp', fetch);

		expect(presignS3Object).toHaveBeenCalledWith(
			expect.objectContaining({ env: expect.objectContaining({ DB: db }) }),
			bucket,
			'rooms/result.webp',
			'ui'
		);
		expect(fetch).toHaveBeenCalledWith('https://signed.example.test/image');
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('content-disposition')).toBe('attachment');
		expect(response.headers.get('content-type')).toBe('image/webp');
		expect(await response.text()).toBe('image-bytes');
	});

	it.each([
		['', 'result.webp'],
		['cadbos-uploads', ''],
		['cadbos-uploads', 'missing.webp']
	])('returns 404 without contacting S3 for %s/%s', async (bucket, filename) => {
		const response = await call(makeD1(), bucket, filename, vi.fn());

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { code: 'image_not_found', message: 'Image not found' }
		});
		expect(presignS3Object).not.toHaveBeenCalled();
	});

	it('returns a sanitized 502 when S3 access fails', async () => {
		const db = makeD1();
		const bucket = await getBucketByName(db, 'cadbos-uploads');
		await getOrCreateMediaByKey(db, bucket, 'result.webp', '');
		presignS3Object.mockRejectedValue(new Error('private provider detail'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await call(db, bucket.name, 'result.webp', vi.fn());

		expect(response.status).toBe(502);
		const body = await response.json();
		expect(body).toEqual({
			error: { code: 'download_failed', message: 'Image download failed' }
		});
		expect(consoleError).toHaveBeenCalledWith('Media download failed:', 'Error');
		expect(JSON.stringify(body)).not.toContain('private provider detail');
	});

	it.each([
		['failed status', new Response('failure', { status: 500 })],
		['missing body', new Response(null, { headers: { 'content-type': 'image/png' } })],
		[
			'unsupported content type',
			new Response('text', { headers: { 'content-type': 'text/plain' } })
		]
	])('rejects an upstream response with %s', async (_case, upstream) => {
		const db = makeD1();
		const bucket = await getBucketByName(db, 'cadbos-uploads');
		await getOrCreateMediaByKey(db, bucket, 'result.webp', '');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const response = await call(
			db,
			bucket.name,
			'result.webp',
			vi.fn(async () => upstream)
		);

		expect(response.status).toBe(502);
		expect(consoleError).toHaveBeenCalledOnce();
	});
});
