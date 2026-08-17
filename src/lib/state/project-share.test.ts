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
import { projectShare } from './project-share.svelte';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	projectShare.clear();
});

afterEach(() => {
	projectShare.clear();
	vi.unstubAllGlobals();
});

describe('projectShare.issueShare / revokeShare', () => {
	it('issues then revokes the active token, without ever needing to pass the token back', async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const url = String(input);
			if (url.endsWith('/share') && init?.method === 'POST') {
				return Promise.resolve(jsonResponse({ token: 'a-token' }, 201));
			}
			if (url.endsWith('/share') && init?.method === 'DELETE') {
				return Promise.resolve(new Response(null, { status: 204 }));
			}
			return Promise.resolve(new Response(null, { status: 404 }));
		});
		vi.stubGlobal('fetch', fetchMock);

		const token = await projectShare.issueShare(PROJECT_ID);
		expect(token).toBe('a-token');
		expect(projectShare.token).toBe('a-token');
		expect(projectShare.status).toBe('active');

		await projectShare.revokeShare(PROJECT_ID);
		expect(projectShare.token).toBeNull();
		expect(projectShare.status).toBe('idle');
	});

	it('surfaces a failed issue as an error status and rethrows', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 500 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(projectShare.issueShare(PROJECT_ID)).rejects.toThrow('share link creation failed');
		expect(projectShare.status).toBe('error');
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
			return Promise.resolve(new Response(null, { status: 404 }));
		});
		vi.stubGlobal('fetch', fetchMock);

		const issue = projectShare.issueShare(PROJECT_ID);
		expect(projectShare.status).toBe('issuing');

		// A revoke starts (and fully resolves) before the issue above settles.
		await projectShare.revokeShare(PROJECT_ID);
		expect(projectShare.status).toBe('idle');

		resolveIssue(jsonResponse({ token: 'stale-token' }, 201));
		await issue;

		// The stale issue must not resurrect a token the revoke already cleared.
		expect(projectShare.status).toBe('idle');
		expect(projectShare.token).toBeNull();
	});
});

describe('projectShare.load', () => {
	it('sets status active and the token when the GET returns 200+token', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(jsonResponse({ token: 'existing-token' }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await projectShare.load(PROJECT_ID);

		expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${PROJECT_ID}/share`);
		expect(projectShare.status).toBe('active');
		expect(projectShare.token).toBe('existing-token');
	});

	it('sets status idle and a null token when the GET returns 404', async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 404 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		await projectShare.load(PROJECT_ID);

		expect(projectShare.status).toBe('idle');
		expect(projectShare.token).toBeNull();
	});
});

describe('projectShare.hydrate', () => {
	it('sets the token when shareActive is true and the response is ok', async () => {
		await projectShare.hydrate(PROJECT_ID, true, jsonResponse({ token: 'existing-token' }));

		expect(projectShare.status).toBe('active');
		expect(projectShare.token).toBe('existing-token');
	});

	it('falls back to a null token when shareActive is true but the response failed', async () => {
		await projectShare.hydrate(PROJECT_ID, true, new Response(null, { status: 500 }));

		expect(projectShare.status).toBe('active');
		expect(projectShare.token).toBeNull();
	});

	it('discards the response and sets status idle when shareActive is false', async () => {
		await projectShare.hydrate(PROJECT_ID, false, jsonResponse({ token: 'ignored' }));

		expect(projectShare.status).toBe('idle');
		expect(projectShare.token).toBeNull();
	});
});
