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
import type { GeneratedImageRecord, GeneratedImagesResponse } from '$lib/api/contract';
import { generatedImages } from './generated-images.svelte';

function image(id: string, createdAt: number): GeneratedImageRecord {
	return {
		id,
		url: `https://cdn.example.test/${id}.webp`,
		createdAt
	};
}

function page(
	images: GeneratedImageRecord[],
	offset: number,
	hasMore: boolean
): GeneratedImagesResponse {
	return {
		images,
		pagination: {
			offset,
			size: 100,
			hasMore
		}
	};
}

function jsonResponse(body: GeneratedImagesResponse): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	generatedImages.clear();
});

afterEach(() => {
	generatedImages.clear();
	vi.unstubAllGlobals();
});

describe('generated images pagination', () => {
	it('loads only the first page and exposes remaining history for loadMore', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse(page([image('first', 2000)], 0, true)));

		await generatedImages.load();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith('/api/generated-images?offset=0&size=100', {
			signal: expect.any(AbortSignal)
		});
		expect(generatedImages.status).toBe('ready');
		expect(generatedImages.images.map((record) => record.id)).toEqual(['first']);
		expect(generatedImages.hasMore).toBe(true);
	});

	it('loads the next page on demand and keeps images latest first', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock
			.mockResolvedValueOnce(jsonResponse(page([image('first', 2000)], 0, true)))
			.mockResolvedValueOnce(jsonResponse(page([image('second', 1000)], 1, false)));

		await generatedImages.load();
		await generatedImages.loadMore();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/generated-images?offset=1&size=100', {
			signal: expect.any(AbortSignal)
		});
		expect(generatedImages.status).toBe('ready');
		expect(generatedImages.images.map((record) => record.id)).toEqual(['first', 'second']);
		expect(generatedImages.hasMore).toBe(false);
		expect(generatedImages.loadingMore).toBe(false);
	});

	it('keeps the next page offset aligned when a loaded image is deleted', async () => {
		const firstPage = Array.from({ length: 100 }, (_, index) =>
			image(`first-${index}`, 3000 - index)
		);
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock
			.mockResolvedValueOnce(jsonResponse(page(firstPage, 0, true)))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(jsonResponse(page([image('second-page', 1000)], 99, false)));

		await generatedImages.load();
		await generatedImages.deleteImage('first-0');
		await generatedImages.loadMore();

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/generated-images?offset=99&size=100', {
			signal: expect.any(AbortSignal)
		});
		expect(generatedImages.images.map((record) => record.id)).toContain('second-page');
		expect(generatedImages.hasMore).toBe(false);
	});
});
