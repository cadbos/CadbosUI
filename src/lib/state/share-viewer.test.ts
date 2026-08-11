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
import type { ProjectDetailResponse } from '$lib/api/contract';
import { shareViewer } from './share-viewer.svelte';

function detail(): ProjectDetailResponse {
	return {
		id: '00000000-0000-4000-8000-000000000001',
		title: 'Living room',
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1),
		shareActive: true,
		sessions: []
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	shareViewer.clear();
});

afterEach(() => {
	shareViewer.clear();
	vi.unstubAllGlobals();
});

describe('shareViewer.load', () => {
	it('loads a shared project by token', async () => {
		const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(detail())));
		vi.stubGlobal('fetch', fetchMock);

		await shareViewer.load('a-token');

		expect(fetchMock).toHaveBeenCalledWith('/api/share/a-token', {
			signal: expect.any(AbortSignal)
		});
		expect(shareViewer.status).toBe('ready');
		expect(shareViewer.project?.title).toBe('Living room');
	});

	it('surfaces a 404 as not-found', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 404 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await shareViewer.load('unknown');

		expect(shareViewer.status).toBe('not-found');
		expect(shareViewer.project).toBeNull();
	});

	it('surfaces a failed request as an error', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 500 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await shareViewer.load('a-token');

		expect(shareViewer.status).toBe('error');
		expect(shareViewer.project).toBeNull();
	});
});
