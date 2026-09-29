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
import type { ResourceDetailResponse, ResourceGenerationRecord } from '$lib/api/contract';
import { mediaAccess } from './media-access.svelte';
import { resourceDetail } from './resource-detail.svelte';

const KEY = 'test-media/room.jpg';

function generation(id: string): ResourceGenerationRecord {
	return {
		id,
		kind: 'render',
		createdAt: 1000,
		image: { key: `test-media/${id}.webp`, url: `https://cdn.example.test/${id}.webp` },
		roles: ['source'],
		session: null,
		settingsSaved: true
	};
}

function detailPage(
	generations: ResourceGenerationRecord[],
	offset: number,
	hasMore: boolean
): ResourceDetailResponse {
	return {
		image: { key: KEY, url: 'https://cdn.example.test/room.jpg' },
		roles: ['source'],
		generations,
		pagination: { offset, size: 30, hasMore }
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	resourceDetail.clear();
	mediaAccess.clear();
});

afterEach(() => {
	resourceDetail.clear();
	mediaAccess.clear();
	vi.unstubAllGlobals();
});

describe('resourceDetail', () => {
	it('requests the key as one encoded path segment and pages through its generations', async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse(detailPage([generation('a')], 0, true)))
			.mockResolvedValueOnce(jsonResponse(detailPage([generation('b')], 1, false)));
		vi.stubGlobal('fetch', fetchMock);

		await resourceDetail.load(KEY);
		await resourceDetail.loadMore();

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			'/api/resources/test-media%2Froom.jpg?offset=0&size=30',
			{ signal: expect.any(AbortSignal) }
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			'/api/resources/test-media%2Froom.jpg?offset=1&size=30',
			{ signal: expect.any(AbortSignal) }
		);
		expect(resourceDetail.status).toBe('ready');
		expect(resourceDetail.roles).toEqual(['source']);
		expect(resourceDetail.generations.map((item) => item.id)).toEqual(['a', 'b']);
		expect(resourceDetail.hasMore).toBe(false);
	});

	it('reports an image that isn’t the user’s resource as not found, not as an error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: {} }, 404))
		);

		await resourceDetail.load(KEY);

		expect(resourceDetail.status).toBe('not-found');
		expect(resourceDetail.image).toBeNull();
	});

	it('reports a failed request as an error', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 503)));

		await resourceDetail.load(KEY);

		expect(resourceDetail.status).toBe('error');
		consoleError.mockRestore();
	});
});
