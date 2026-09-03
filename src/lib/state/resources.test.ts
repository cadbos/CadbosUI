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
import type { ResourceImageRecord, ResourcesResponse } from '$lib/api/contract';
import { mediaAccess } from './media-access.svelte';
import { resources } from './resources.svelte';

function image(url: string, createdAt: number): ResourceImageRecord {
	return { image: { key: new URL(url).pathname, url }, createdAt };
}

function page(images: ResourceImageRecord[], offset: number, hasMore: boolean): ResourcesResponse {
	return {
		images,
		pagination: {
			offset,
			size: 30,
			hasMore
		}
	};
}

function jsonResponse(body: ResourcesResponse): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function mockResourcesFetch(pages: ResourcesResponse[]) {
	let pageIndex = 0;
	return vi.fn<typeof fetch>((input) => {
		const url = String(input);
		if (url.startsWith('/api/resources?')) {
			const page = pages[pageIndex++];
			if (page === undefined)
				throw new Error(`No mocked resources page for index ${pageIndex - 1}`);
			return Promise.resolve(jsonResponse(page));
		}
		return Promise.resolve(new Response(null, { status: 404 }));
	});
}

beforeEach(() => {
	resources.clear();
	mediaAccess.clear();
});

afterEach(() => {
	resources.clear();
	mediaAccess.clear();
	vi.unstubAllGlobals();
});

describe('resources pagination', () => {
	it('loads the first resources page and exposes remaining records for loadMore', async () => {
		const fetchMock = mockResourcesFetch([
			page([image('https://cdn.example/one.jpg', Date.UTC(2026, 0, 1))], 0, true)
		]);
		vi.stubGlobal('fetch', fetchMock);

		await resources.load();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith('/api/resources?offset=0&size=30', {
			signal: expect.any(AbortSignal)
		});
		expect(resources.status).toBe('ready');
		expect(resources.images.map((record) => record.image.url)).toEqual([
			'https://cdn.example/one.jpg'
		]);
		expect(resources.hasMore).toBe(true);
	});

	it('loads the next resources page on demand', async () => {
		const fetchMock = mockResourcesFetch([
			page([image('https://cdn.example/one.jpg', Date.UTC(2026, 0, 1))], 0, true),
			page([image('https://cdn.example/two.jpg', Date.UTC(2026, 0, 2))], 1, false)
		]);
		vi.stubGlobal('fetch', fetchMock);

		await resources.load();
		await resources.loadMore();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledWith('/api/resources?offset=1&size=30', {
			signal: expect.any(AbortSignal)
		});
		expect(resources.status).toBe('ready');
		expect(resources.images.map((record) => record.image.url)).toEqual([
			'https://cdn.example/one.jpg',
			'https://cdn.example/two.jpg'
		]);
		expect(resources.hasMore).toBe(false);
		expect(resources.loadingMore).toBe(false);
	});

	it('surfaces invalid resources responses as load errors', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(JSON.stringify({ images: [{ image: { key: 'one.jpg', url: '' } }] }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);
		vi.stubGlobal('fetch', fetchMock);

		await resources.load();

		expect(resources.status).toBe('error');
		expect(resources.images).toEqual([]);
		expect(resources.error).toBe('ResourcesLoadError');
	});

	it('surfaces a failed resources request as a load error', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 500 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await resources.load();

		expect(resources.status).toBe('error');
		expect(resources.images).toEqual([]);
		expect(resources.error).toBe('ResourcesLoadError');
	});
});
