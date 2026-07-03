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

import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

type DownloadEvent = Parameters<typeof GET>[0];

function call(
	searchParams: Record<string, string>,
	fetch: typeof globalThis.fetch
): ReturnType<typeof GET> {
	return GET({
		url: new URL(`https://cadbos.example/api/download?${new URLSearchParams(searchParams)}`),
		fetch
	} as DownloadEvent);
}

function imageResponse(contentType: string, body = 'image-bytes'): Response {
	return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

describe('GET /api/download', () => {
	it('streams the upstream image with a forced-download header', async () => {
		const fetch = vi.fn(async () => imageResponse('image/webp'));

		const response = await call(
			{ url: 'https://cdn.example/render.webp', filename: 'render.webp' },
			fetch
		);

		expect(fetch).toHaveBeenCalledWith(new URL('https://cdn.example/render.webp'));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/webp');
		expect(response.headers.get('content-disposition')).toBe('attachment; filename="render.webp"');
		expect(await response.text()).toBe('image-bytes');
	});

	it('rejects a missing url parameter', async () => {
		const fetch = vi.fn();
		await expect(call({}, fetch)).rejects.toMatchObject({ status: 400 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects a non-https url', async () => {
		const fetch = vi.fn();
		await expect(call({ url: 'http://cdn.example/render.webp' }, fetch)).rejects.toMatchObject({
			status: 400
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects an unparseable url', async () => {
		const fetch = vi.fn();
		await expect(call({ url: 'not-a-url' }, fetch)).rejects.toMatchObject({ status: 400 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects a non-image upstream response', async () => {
		const fetch = vi.fn(async () => imageResponse('application/json', '{}'));

		await expect(call({ url: 'https://cdn.example/render.webp' }, fetch)).rejects.toMatchObject({
			status: 502
		});
	});

	it('rejects a failed upstream fetch', async () => {
		const fetch = vi.fn(async () => new Response('nope', { status: 500 }));

		await expect(call({ url: 'https://cdn.example/render.webp' }, fetch)).rejects.toMatchObject({
			status: 502
		});
	});
});
