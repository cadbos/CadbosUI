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
import type {
	GeneratedImagesResponse,
	SceneFilterOptionsResponse,
	SceneRecord
} from '$lib/api/contract';
import { generatedImages } from './generated-images.svelte';
import { mediaAccess } from './media-access.svelte';

function image(id: string, createdAt: number): SceneRecord {
	return {
		id,
		image: {
			key: `${id}.webp`,
			url: `/api/media/test-media/${id}.webp`
		},
		source: {
			key: `${id}-source.jpg`,
			url: `/api/media/test-media/${id}-source.jpg`
		},
		kind: 'render',
		createdAt,
		session: null,
		iteration: null,
		number: 1
	};
}

function page(images: SceneRecord[], offset: number, hasMore: boolean): GeneratedImagesResponse {
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
	mediaAccess.clear();
});

afterEach(() => {
	generatedImages.clear();
	mediaAccess.clear();
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

describe('scene filter', () => {
	const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
	const SESSION_ID = '00000000-0000-4000-8000-000000000011';

	function optionsResponse(body: SceneFilterOptionsResponse): Response {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	it('requests the selected view, project and session, and keeps them for later reloads', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockImplementation(async () => jsonResponse(page([image('scene', 1000)], 0, false)));

		generatedImages.setFilter({ view: 'milestones', projectId: PROJECT_ID, sessionId: SESSION_ID });
		await vi.waitFor(() => expect(generatedImages.status).toBe('ready'));
		await generatedImages.load();

		const expectedUrl =
			`/api/generated-images?offset=0&size=100&view=milestones` +
			`&projectId=${PROJECT_ID}&sessionId=${SESSION_ID}`;
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([expectedUrl, expectedUrl]);
	});

	it('loads the filter options', async () => {
		const projects = [
			{
				projectId: PROJECT_ID,
				projectTitle: 'Flat',
				sessions: [{ sessionId: SESSION_ID, sessionTitle: 'Kitchen' }]
			}
		];
		vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(optionsResponse({ projects })));

		await generatedImages.loadFilterOptions();

		expect(generatedImages.filterOptionsStatus).toBe('ready');
		expect(generatedImages.filterProjects).toEqual(projects);
	});

	it('falls back to every project when the selected one is no longer offered', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock
			.mockResolvedValueOnce(jsonResponse(page([], 0, false)))
			.mockResolvedValueOnce(optionsResponse({ projects: [] }))
			.mockResolvedValueOnce(jsonResponse(page([image('scene', 1000)], 0, false)));

		generatedImages.setFilter({ view: 'milestones', projectId: PROJECT_ID, sessionId: SESSION_ID });
		await vi.waitFor(() => expect(generatedImages.status).toBe('ready'));
		await generatedImages.loadFilterOptions();

		expect(generatedImages.filter).toEqual({
			view: 'milestones',
			projectId: null,
			sessionId: null
		});
		await vi.waitFor(() =>
			expect(generatedImages.images.map((scene) => scene.id)).toEqual(['scene'])
		);
		expect(fetchMock).toHaveBeenLastCalledWith(
			'/api/generated-images?offset=0&size=100&view=milestones',
			{ signal: expect.any(AbortSignal) }
		);
	});

	it('reports a failed options request without touching the scenes', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }))
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await generatedImages.loadFilterOptions();

		expect(generatedImages.filterOptionsStatus).toBe('error');
		expect(generatedImages.status).toBe('idle');
	});
});
