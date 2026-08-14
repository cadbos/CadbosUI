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
import { projectDetail } from './project-detail.svelte';

function detail(overrides: Partial<ProjectDetailResponse> = {}): ProjectDetailResponse {
	return {
		id: '00000000-0000-4000-8000-000000000001',
		title: 'Living room',
		createdAt: Date.UTC(2026, 0, 1),
		updatedAt: Date.UTC(2026, 0, 1),
		shareActive: false,
		sessions: [],
		...overrides
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	projectDetail.clear();
});

afterEach(() => {
	projectDetail.clear();
	vi.unstubAllGlobals();
});

describe('projectDetail.load', () => {
	it('loads a project detail', async () => {
		const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(detail())));
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');

		expect(fetchMock).toHaveBeenCalledWith('/api/projects/00000000-0000-4000-8000-000000000001', {
			signal: expect.any(AbortSignal)
		});
		expect(projectDetail.status).toBe('ready');
		expect(projectDetail.project?.title).toBe('Living room');
	});

	it('surfaces a 404 as not-found, not a generic error', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 404 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('unknown');

		expect(projectDetail.status).toBe('not-found');
		expect(projectDetail.project).toBeNull();
	});

	it('surfaces a non-404 failure response as a generic error', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 500 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');

		expect(projectDetail.status).toBe('error');
		expect(projectDetail.error).toBeTruthy();
		expect(projectDetail.project).toBeNull();
	});

	it('surfaces a malformed response body as a generic error', async () => {
		const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ nonsense: true })));
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');

		expect(projectDetail.status).toBe('error');
		expect(projectDetail.error).toBeTruthy();
		expect(projectDetail.project).toBeNull();
	});
});

describe('projectDetail.rename', () => {
	it('updates the in-memory title on success', async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			if (init?.method === 'PATCH') {
				return Promise.resolve(
					jsonResponse({ title: 'Bedroom', createdAt: detail().createdAt, updatedAt: Date.now() })
				);
			}
			return Promise.resolve(jsonResponse(detail()));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		await projectDetail.rename('Bedroom');

		expect(projectDetail.project?.title).toBe('Bedroom');
		expect(projectDetail.renaming).toBe(false);
	});

	it('keeps a newer rename marked busy after an older, now-orphaned one resolves', async () => {
		let resolveFirstPatch!: (response: Response) => void;
		const firstPatchPromise = new Promise<Response>((resolve) => {
			resolveFirstPatch = resolve;
		});
		let resolveSecondPatch!: (response: Response) => void;
		const secondPatchPromise = new Promise<Response>((resolve) => {
			resolveSecondPatch = resolve;
		});
		const otherProject = detail({ id: '00000000-0000-4000-8000-000000000002', title: 'Kitchen' });
		let patchCount = 0;
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const url = String(input);
			if (init?.method === 'PATCH') {
				patchCount += 1;
				return patchCount === 1 ? firstPatchPromise : secondPatchPromise;
			}
			if (url.endsWith(otherProject.id)) return Promise.resolve(jsonResponse(otherProject));
			return Promise.resolve(jsonResponse(detail()));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		const rename = projectDetail.rename('Bedroom');

		// Navigate to a different project before the first rename resolves,
		// then rename *it* before that original request settles.
		await projectDetail.load(otherProject.id);
		const otherRename = projectDetail.rename('Dining room');
		expect(projectDetail.renaming).toBe(true);

		resolveFirstPatch(jsonResponse({ title: 'Bedroom', updatedAt: Date.now() }));
		await rename;

		// The orphaned first rename's finally must not clear the second one's
		// still-in-flight busy flag.
		expect(projectDetail.renaming).toBe(true);
		expect(projectDetail.project?.title).toBe('Kitchen');

		resolveSecondPatch(jsonResponse({ title: 'Dining room', updatedAt: Date.now() }));
		await otherRename;
		expect(projectDetail.renaming).toBe(false);
	});
});

describe('projectDetail.createSession', () => {
	it('appends the new session without a reload', async () => {
		const fetchMock = vi.fn<typeof fetch>((input) => {
			const url = String(input);
			if (url.endsWith('/sessions')) {
				return Promise.resolve(
					jsonResponse(
						{
							id: '00000000-0000-4000-8000-000000000099',
							title: '',
							createdAt: Date.now(),
							updatedAt: Date.now()
						},
						201
					)
				);
			}
			return Promise.resolve(jsonResponse(detail()));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		const session = await projectDetail.createSession();

		expect(session.id).toBe('00000000-0000-4000-8000-000000000099');
		expect(projectDetail.project?.sessions.map((s) => s.id)).toEqual([session.id]);
		expect(projectDetail.creatingSession).toBe(false);
	});
});

describe('projectDetail share flow', () => {
	it('issues then revokes the active token, without ever needing to pass the token back', async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const url = String(input);
			if (url.endsWith('/share') && init?.method === 'POST') {
				return Promise.resolve(jsonResponse({ token: 'a-token' }, 201));
			}
			if (url.endsWith('/share') && init?.method === 'DELETE') {
				return Promise.resolve(new Response(null, { status: 204 }));
			}
			return Promise.resolve(jsonResponse(detail()));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		const token = await projectDetail.issueShare();
		expect(token).toBe('a-token');
		expect(projectDetail.shareToken).toBe('a-token');
		expect(projectDetail.shareStatus).toBe('active');
		expect(projectDetail.project?.shareActive).toBe(true);

		await projectDetail.revokeShare();
		expect(projectDetail.shareToken).toBeNull();
		expect(projectDetail.shareStatus).toBe('idle');
		expect(projectDetail.project?.shareActive).toBe(false);
	});

	it('surfaces a failed issue as an error status and rethrows', async () => {
		const fetchMock = vi.fn<typeof fetch>((input) => {
			const url = String(input);
			if (url.endsWith('/share')) return Promise.resolve(new Response(null, { status: 500 }));
			return Promise.resolve(jsonResponse(detail()));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		await expect(projectDetail.issueShare()).rejects.toThrow('share link creation failed');
		expect(projectDetail.shareStatus).toBe('error');
	});

	it('ignores a stale issue response that resolves after a newer revoke already ran', async () => {
		let resolveIssue!: (response: Response) => void;
		const issuePromise = new Promise<Response>((resolve) => {
			resolveIssue = resolve;
		});
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const url = String(input);
			if (url.endsWith('/share') && init?.method === 'POST') return issuePromise;
			if (url.endsWith('/share') && init?.method === 'DELETE') {
				return Promise.resolve(new Response(null, { status: 204 }));
			}
			return Promise.resolve(jsonResponse(detail()));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		const issue = projectDetail.issueShare();
		expect(projectDetail.shareStatus).toBe('issuing');

		// A revoke starts (and fully resolves) before the issue above settles.
		await projectDetail.revokeShare();
		expect(projectDetail.shareStatus).toBe('idle');

		resolveIssue(jsonResponse({ token: 'stale-token' }, 201));
		await issue;

		// The stale issue must not resurrect a token the revoke already cleared.
		expect(projectDetail.shareStatus).toBe('idle');
		expect(projectDetail.shareToken).toBeNull();
		expect(projectDetail.project?.shareActive).toBe(false);
	});

	it('load() seeds shareStatus from the server-reported shareActive flag', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(jsonResponse(detail({ shareActive: true })))
		);
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		expect(projectDetail.shareStatus).toBe('active');
		expect(projectDetail.shareToken).toBeNull();
	});
});

describe('projectDetail.renameSession', () => {
	it('updates the session title in place', async () => {
		const session = {
			id: '00000000-0000-4000-8000-000000000050',
			title: 'Main thread',
			parentSessionId: null,
			forkedFromGenerationId: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			generations: []
		};
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			if (init?.method === 'PATCH') {
				return Promise.resolve(jsonResponse({ title: 'Cozy corner', updatedAt: Date.now() }));
			}
			return Promise.resolve(jsonResponse(detail({ sessions: [session] })));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		await projectDetail.renameSession(session.id, 'Cozy corner');

		expect(projectDetail.project?.sessions[0]?.title).toBe('Cozy corner');
		expect(projectDetail.renamingSessionId).toBeNull();
	});

	it('resets renamingSessionId even when the request fails', async () => {
		const session = {
			id: '00000000-0000-4000-8000-000000000050',
			title: 'Main thread',
			parentSessionId: null,
			forkedFromGenerationId: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			generations: []
		};
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			if (init?.method === 'PATCH') return Promise.resolve(new Response(null, { status: 500 }));
			return Promise.resolve(jsonResponse(detail({ sessions: [session] })));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		await expect(projectDetail.renameSession(session.id, 'Cozy corner')).rejects.toThrow(
			'session rename failed'
		);

		expect(projectDetail.renamingSessionId).toBeNull();
		expect(projectDetail.project?.sessions[0]?.title).toBe('Main thread');
	});

	it('ignores a late response for a session rename issued against a project the user has since left, and keeps the newer rename marked busy', async () => {
		let resolveFirstPatch!: (response: Response) => void;
		const firstPatchPromise = new Promise<Response>((resolve) => {
			resolveFirstPatch = resolve;
		});
		const session = {
			id: '00000000-0000-4000-8000-000000000050',
			title: 'Main thread',
			parentSessionId: null,
			forkedFromGenerationId: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			generations: []
		};
		const otherSession = {
			id: '00000000-0000-4000-8000-000000000051',
			title: 'Second thread',
			parentSessionId: null,
			forkedFromGenerationId: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			generations: []
		};
		const otherProject = detail({
			id: '00000000-0000-4000-8000-000000000002',
			title: 'Kitchen',
			sessions: [otherSession]
		});
		let resolveSecondPatch!: (response: Response) => void;
		const secondPatchPromise = new Promise<Response>((resolve) => {
			resolveSecondPatch = resolve;
		});
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const url = String(input);
			if (init?.method === 'PATCH' && url.includes(session.id)) return firstPatchPromise;
			if (init?.method === 'PATCH' && url.includes(otherSession.id)) return secondPatchPromise;
			if (url.endsWith(otherProject.id)) return Promise.resolve(jsonResponse(otherProject));
			return Promise.resolve(jsonResponse(detail({ sessions: [session] })));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		const rename = projectDetail.renameSession(session.id, 'Cozy corner');

		// The user navigates to a different project before the rename resolves,
		// then starts renaming *its* session before the original request settles.
		await projectDetail.load(otherProject.id);
		const otherRename = projectDetail.renameSession(otherSession.id, 'Renamed');
		expect(projectDetail.renamingSessionId).toBe(otherSession.id);

		resolveFirstPatch(jsonResponse({ title: 'Cozy corner', updatedAt: Date.now() }));
		await rename;

		expect(projectDetail.project?.id).toBe(otherProject.id);
		expect(projectDetail.project?.title).toBe('Kitchen');
		// The stale rename's finally must not clear a still-in-flight newer one.
		expect(projectDetail.renamingSessionId).toBe(otherSession.id);

		resolveSecondPatch(jsonResponse({ title: 'Renamed', updatedAt: Date.now() }));
		await otherRename;
		expect(projectDetail.renamingSessionId).toBeNull();
	});
});

describe('projectDetail.archiveSession', () => {
	it('removes the session from the in-memory list', async () => {
		const session = {
			id: '00000000-0000-4000-8000-000000000050',
			title: 'Main thread',
			parentSessionId: null,
			forkedFromGenerationId: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			generations: []
		};
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
			return Promise.resolve(jsonResponse(detail({ sessions: [session] })));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		await projectDetail.archiveSession(session.id);

		expect(projectDetail.project?.sessions).toEqual([]);
		expect(projectDetail.archivingSessionId).toBeNull();
	});

	it('resets archivingSessionId, and keeps the session listed, when the request fails', async () => {
		const session = {
			id: '00000000-0000-4000-8000-000000000050',
			title: 'Main thread',
			parentSessionId: null,
			forkedFromGenerationId: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			generations: []
		};
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 500 }));
			return Promise.resolve(jsonResponse(detail({ sessions: [session] })));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		await expect(projectDetail.archiveSession(session.id)).rejects.toThrow(
			'session archive failed'
		);

		expect(projectDetail.archivingSessionId).toBeNull();
		expect(projectDetail.project?.sessions).toEqual([session]);
	});
});

describe('projectDetail.archiveProject', () => {
	it('calls DELETE on the project and clears the archiving flag', async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
			return Promise.resolve(jsonResponse(detail()));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		await projectDetail.archiveProject();

		expect(fetchMock).toHaveBeenCalledWith('/api/projects/00000000-0000-4000-8000-000000000001', {
			method: 'DELETE'
		});
		expect(projectDetail.archivingProject).toBe(false);
	});

	it('resets archivingProject when the request fails', async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 500 }));
			return Promise.resolve(jsonResponse(detail()));
		});
		vi.stubGlobal('fetch', fetchMock);

		await projectDetail.load('00000000-0000-4000-8000-000000000001');
		await expect(projectDetail.archiveProject()).rejects.toThrow('project archive failed');

		expect(projectDetail.archivingProject).toBe(false);
	});
});
