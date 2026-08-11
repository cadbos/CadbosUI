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
import type { ProjectRecord, ProjectsResponse } from '$lib/api/contract';
import { projects } from './projects.svelte';

function project(id: string, title: string, updatedAt: number): ProjectRecord {
	return { id, title, createdAt: updatedAt, updatedAt };
}

function page(projectsPage: ProjectRecord[], offset: number, hasMore: boolean): ProjectsResponse {
	return {
		projects: projectsPage,
		pagination: { offset, size: 20, hasMore }
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function mockProjectsFetch(pages: ProjectsResponse[]) {
	let pageIndex = 0;
	return vi.fn<typeof fetch>((input) => {
		const url = String(input);
		if (url.startsWith('/api/projects?')) {
			const currentPage = pages[pageIndex++];
			if (currentPage === undefined)
				throw new Error(`No mocked projects page for index ${pageIndex - 1}`);
			return Promise.resolve(jsonResponse(currentPage));
		}
		return Promise.resolve(new Response(null, { status: 404 }));
	});
}

const uuid1 = '00000000-0000-4000-8000-000000000001';
const uuid2 = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
	projects.clear();
});

afterEach(() => {
	projects.clear();
	vi.unstubAllGlobals();
});

describe('projects pagination', () => {
	it('loads the first projects page and exposes remaining records for loadMore', async () => {
		const fetchMock = mockProjectsFetch([
			page([project(uuid1, 'Living room', Date.UTC(2026, 0, 1))], 0, true)
		]);
		vi.stubGlobal('fetch', fetchMock);

		await projects.load();

		expect(fetchMock).toHaveBeenCalledWith('/api/projects?offset=0&size=20', {
			signal: expect.any(AbortSignal)
		});
		expect(projects.status).toBe('ready');
		expect(projects.projects.map((record) => record.id)).toEqual([uuid1]);
		expect(projects.hasMore).toBe(true);
	});

	it('loads the next projects page on demand', async () => {
		const fetchMock = mockProjectsFetch([
			page([project(uuid1, 'Living room', Date.UTC(2026, 0, 1))], 0, true),
			page([project(uuid2, 'Kitchen', Date.UTC(2026, 0, 2))], 1, false)
		]);
		vi.stubGlobal('fetch', fetchMock);

		await projects.load();
		await projects.loadMore();

		expect(projects.projects.map((record) => record.id)).toEqual([uuid1, uuid2]);
		expect(projects.hasMore).toBe(false);
	});

	it('surfaces a failed projects request as a load error', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 500 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await projects.load();

		expect(projects.status).toBe('error');
		expect(projects.projects).toEqual([]);
		expect(projects.error).toBe('ProjectsLoadError');
	});
});

describe('projects.create', () => {
	it('creates a project and prepends it to the list', async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const url = String(input);
			if (url === '/api/projects' && init?.method === 'POST') {
				return Promise.resolve(
					jsonResponse(project(uuid1, 'Living room', Date.UTC(2026, 0, 1)), 201)
				);
			}
			return Promise.resolve(new Response(null, { status: 404 }));
		});
		vi.stubGlobal('fetch', fetchMock);

		const created = await projects.create('Living room');

		expect(created.id).toBe(uuid1);
		expect(projects.projects.map((record) => record.id)).toEqual([uuid1]);
		expect(projects.creating).toBe(false);
	});

	it('throws when project creation fails', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 500 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(projects.create('Living room')).rejects.toThrow('project creation failed');
		expect(projects.creating).toBe(false);
	});
});

describe('projects.archive', () => {
	it('removes the project from the in-memory list', async () => {
		const fetchMock = vi.fn<typeof fetch>((input) => {
			if (String(input) === '/api/projects?offset=0&size=20') {
				return Promise.resolve(
					jsonResponse(
						page(
							[
								project(uuid1, 'Living room', Date.UTC(2026, 0, 1)),
								project(uuid2, 'Kitchen', Date.UTC(2026, 0, 2))
							],
							0,
							false
						)
					)
				);
			}
			return Promise.resolve(new Response(null, { status: 204 }));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projects.load();
		await projects.archive(uuid1);

		expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${uuid1}`, { method: 'DELETE' });
		expect(projects.projects.map((record) => record.id)).toEqual([uuid2]);
		expect(projects.archivingId).toBeNull();
	});

	it('throws when the archive request fails', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 500 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(projects.archive(uuid1)).rejects.toThrow('project archive failed');
		expect(projects.archivingId).toBeNull();
	});
});
