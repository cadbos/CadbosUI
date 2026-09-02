/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '$lib/state/request.svelte';
import { mediaAccess } from '$lib/state/media-access.svelte';
import {
	initializeGenerationPreview,
	SCRATCH_TAB_ID,
	workspaceTabs
} from '$lib/state/workspace-tabs.svelte';

const PROJECT_A = '00000000-0000-4000-8000-000000000001';
const PROJECT_B = '00000000-0000-4000-8000-000000000002';
const SESSION_A1 = '00000000-0000-4000-8000-0000000000a1';
const SESSION_A2 = '00000000-0000-4000-8000-0000000000a2';
const SESSION_B1 = '00000000-0000-4000-8000-0000000000b1';

// Node (this suite runs in the 'node' vitest environment, not jsdom) has no
// global localStorage — a minimal in-memory stand-in, same Storage shape the
// browser provides, is enough to exercise workspaceTabs' own persistence.
function memoryLocalStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		}
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryLocalStorage());
	mediaAccess.clear();
});

afterEach(() => {
	// Reset back to a single scratch tab so state doesn't leak between tests.
	// The scratch tab itself can never be closed, so this always terminates.
	while (workspaceTabs.tabs.length > 1) {
		workspaceTabs.close(workspaceTabs.tabs[workspaceTabs.tabs.length - 1].id);
	}
	request.reset();
	mediaAccess.clear();
	vi.unstubAllGlobals();
});

describe('workspaceTabs.openProject', () => {
	it('opens a new tab and session tab, activates them, and initializes request state', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A1);
				state.setEditPrompt('warm living room');
			}
		});

		expect(workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_A]);
		expect(workspaceTabs.activeTabId).toBe(PROJECT_A);
		expect(workspaceTabs.activeSessionTabs.map((session) => session.id)).toEqual([SESSION_A1]);
		expect(request.projectId).toBe(PROJECT_A);
		expect(request.sessionId).toBe(SESSION_A1);
		expect(request.editPrompt).toBe('warm living room');
	});

	it('keeps each open project tab independent when switching between them', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A1);
				state.setEditPrompt('project A prompt');
			}
		});
		workspaceTabs.openProject({
			projectId: PROJECT_B,
			projectTitle: 'Kitchen',
			sessionId: SESSION_B1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_B, SESSION_B1);
				state.setEditPrompt('project B prompt');
			}
		});

		expect(request.projectId).toBe(PROJECT_B);
		expect(request.editPrompt).toBe('project B prompt');

		workspaceTabs.activate(PROJECT_A);

		expect(request.projectId).toBe(PROJECT_A);
		expect(request.editPrompt).toBe('project A prompt');

		workspaceTabs.activate(PROJECT_B);

		expect(request.projectId).toBe(PROJECT_B);
		expect(request.editPrompt).toBe('project B prompt');
	});

	it('opening a second session in an already-open project adds a session tab instead of overwriting it', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A1);
				state.setEditPrompt('first visit');
			}
		});
		workspaceTabs.openProject({
			projectId: PROJECT_B,
			projectTitle: 'Kitchen',
			sessionId: SESSION_B1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_B, SESSION_B1)
		});

		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A2,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A2);
				state.setEditPrompt('second visit');
			}
		});

		expect(workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_A, PROJECT_B]);
		const projectATab = workspaceTabs.tabs.find((tab) => tab.id === PROJECT_A);
		expect(projectATab?.sessionTabs.map((session) => session.id)).toEqual([SESSION_A1, SESSION_A2]);
		expect(request.projectId).toBe(PROJECT_A);
		expect(request.sessionId).toBe(SESSION_A2);
		expect(request.editPrompt).toBe('second visit');

		// The first session's draft survived untouched under the first tab.
		workspaceTabs.activateSession(PROJECT_A, SESSION_A1);
		expect(request.sessionId).toBe(SESSION_A1);
		expect(request.editPrompt).toBe('first visit');
	});
});

describe('initializeGenerationPreview', () => {
	it('seeds the generation as the after step and its source as the synthetic before', () => {
		const session = {
			id: SESSION_A1,
			title: 'Main thread',
			parentSessionId: null,
			forkedFromGenerationId: null,
			createdAt: 0,
			updatedAt: 0,
			generations: []
		};
		const generation = {
			id: 'gen-1',
			image: { key: 'cadbos-uploads/after.webp', url: 'https://example.test/after.webp' },
			source: { key: 'cadbos-uploads/before.webp', url: 'https://example.test/before.webp' },
			kind: 'render' as const,
			createdAt: 1000,
			amount: 1.5,
			balanceAfter: 8.5
		};

		initializeGenerationPreview(request, PROJECT_A, session, generation);

		expect(request.projectId).toBe(PROJECT_A);
		expect(request.sessionId).toBe(SESSION_A1);
		expect(request.image).toEqual({ mediaKey: generation.source.key });
		expect(mediaAccess.get(generation.source.key)?.url).toBe(generation.source.url);
		expect(request.currentRender?.outputKey).toBe(generation.image.key);
		expect(request.currentRender?.cost).toBe(1.5);
		expect(request.currentRender?.balance).toBe(8.5);
		expect(request.previousRender?.outputKey).toBe(generation.source.key);
		expect(request.viewingGenerationId).toBe('gen-1');
	});
});

describe('workspaceTabs.adoptScratchSession', () => {
	it('promotes the live scratch tab into a real project tab without losing its content', () => {
		request.setEditPrompt('in-progress scratch work');

		workspaceTabs.adoptScratchSession(PROJECT_A, 'Untitled', SESSION_A1, null);

		expect(workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_A]);
		expect(workspaceTabs.activeTabId).toBe(PROJECT_A);
		expect(workspaceTabs.activeTab.activeSessionTabId).toBe(SESSION_A1);
		expect(request.editPrompt).toBe('in-progress scratch work');
	});

	it('is a no-op once the live tab is no longer scratch', () => {
		workspaceTabs.adoptScratchSession(PROJECT_A, 'Untitled', SESSION_A1, null);
		workspaceTabs.adoptScratchSession(PROJECT_B, 'Untitled', SESSION_B1, null);

		expect(workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_A]);
	});

	it('leaves a fresh, blank state behind on the scratch tab', () => {
		request.setEditPrompt('in-progress scratch work');
		workspaceTabs.adoptScratchSession(PROJECT_A, 'Untitled', SESSION_A1, null);

		workspaceTabs.activate(SCRATCH_TAB_ID);

		expect(request.editPrompt).toBe('');
		expect(request.projectId).toBeUndefined();
	});
});

describe('workspaceTabs.activate', () => {
	it('is a no-op for an id that is not an open tab', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});

		workspaceTabs.activate('not-open');

		expect(workspaceTabs.activeTabId).toBe(PROJECT_A);
	});
});

describe('workspaceTabs.activateSession', () => {
	it('switches sessions within the same project tab, preserving each draft independently', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A1);
				state.setEditPrompt('session A1 prompt');
			}
		});
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A2,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A2);
				state.setEditPrompt('session A2 prompt');
			}
		});

		expect(request.sessionId).toBe(SESSION_A2);
		expect(request.editPrompt).toBe('session A2 prompt');

		workspaceTabs.activateSession(PROJECT_A, SESSION_A1);
		expect(request.sessionId).toBe(SESSION_A1);
		expect(request.editPrompt).toBe('session A1 prompt');

		workspaceTabs.activateSession(PROJECT_A, SESSION_A2);
		expect(request.sessionId).toBe(SESSION_A2);
		expect(request.editPrompt).toBe('session A2 prompt');
	});
});

describe('workspaceTabs.retargetSession', () => {
	it('renames the live session tab in place, keeping its title', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: 'Main thread',
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});

		// Mirrors StyleTransferPanel's own call order: the live RequestState is
		// retargeted first (its own responsibility), then the tab bookkeeping.
		request.setProjectSession(PROJECT_A, SESSION_A2);
		workspaceTabs.retargetSession(SESSION_A1, SESSION_A2);

		const projectATab = workspaceTabs.tabs.find((tab) => tab.id === PROJECT_A);
		expect(projectATab?.sessionTabs.map((session) => session.id)).toEqual([SESSION_A2]);
		expect(projectATab?.sessionTabs[0]?.title).toBe('Main thread');
		expect(projectATab?.activeSessionTabId).toBe(SESSION_A2);

		// The tab bookkeeping must resolve to the new id going forward, even
		// after switching away and back.
		workspaceTabs.activate(SCRATCH_TAB_ID);
		workspaceTabs.activateSession(PROJECT_A, SESSION_A2);
		expect(request.sessionId).toBe(SESSION_A2);
	});
});

describe('workspaceTabs.closeSession', () => {
	it('closing a background session tab leaves the active session untouched', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A2,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A2);
				state.setEditPrompt('session A2 prompt');
			}
		});

		workspaceTabs.closeSession(PROJECT_A, SESSION_A1);

		const projectATab = workspaceTabs.tabs.find((tab) => tab.id === PROJECT_A);
		expect(projectATab?.sessionTabs.map((session) => session.id)).toEqual([SESSION_A2]);
		expect(request.sessionId).toBe(SESSION_A2);
		expect(request.editPrompt).toBe('session A2 prompt');
	});

	it('closing the active session tab falls back to a neighboring session tab', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A1);
				state.setEditPrompt('session A1 prompt');
			}
		});
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A2,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A2)
		});

		workspaceTabs.closeSession(PROJECT_A, SESSION_A2);

		expect(request.sessionId).toBe(SESSION_A1);
		expect(request.editPrompt).toBe('session A1 prompt');
	});

	it('does not resurrect a closed (and reused) session id’s old draft', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A2,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A2);
				state.setEditPrompt('leaked draft');
			}
		});

		// SESSION_A2 is the active (live) tab here — closing it must discard
		// its draft outright instead of freezing it under its own, now-removed
		// id, where it would sit forever unreleased and reappear the next time
		// that id is opened.
		workspaceTabs.closeSession(PROJECT_A, SESSION_A2);

		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A2,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A2)
		});

		expect(request.editPrompt).toBe('');
	});

	it('closing the last session tab of a project closes the whole project tab', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});

		workspaceTabs.closeSession(PROJECT_A, SESSION_A1);

		expect(workspaceTabs.tabs).toEqual([
			{ id: SCRATCH_TAB_ID, title: null, sessionTabs: [], activeSessionTabId: null }
		]);
		expect(workspaceTabs.activeTabId).toBe(SCRATCH_TAB_ID);
		expect(request.projectId).toBeUndefined();
	});
});

describe('workspaceTabs.close', () => {
	it('closing a background tab leaves the active project untouched', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		workspaceTabs.openProject({
			projectId: PROJECT_B,
			projectTitle: 'Kitchen',
			sessionId: SESSION_B1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_B, SESSION_B1);
				state.setEditPrompt('project B prompt');
			}
		});

		workspaceTabs.close(PROJECT_A);

		expect(workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_B]);
		expect(workspaceTabs.activeTabId).toBe(PROJECT_B);
		expect(request.editPrompt).toBe('project B prompt');
	});

	it('closing the active tab falls back to a neighboring tab, restoring its state', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A1);
				state.setEditPrompt('project A prompt');
			}
		});
		workspaceTabs.openProject({
			projectId: PROJECT_B,
			projectTitle: 'Kitchen',
			sessionId: SESSION_B1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_B, SESSION_B1)
		});

		workspaceTabs.close(PROJECT_B);

		expect(workspaceTabs.activeTabId).toBe(PROJECT_A);
		expect(request.projectId).toBe(PROJECT_A);
		expect(request.editPrompt).toBe('project A prompt');
	});

	it('does not resurrect a closed (and reused) project’s old draft', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		workspaceTabs.openProject({
			projectId: PROJECT_B,
			projectTitle: 'Kitchen',
			sessionId: SESSION_B1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_B, SESSION_B1);
				state.setEditPrompt('leaked draft');
			}
		});

		// PROJECT_B is the active tab here — closing it must discard its draft
		// outright instead of freezing it under its own, now-removed session id.
		workspaceTabs.close(PROJECT_B);

		workspaceTabs.openProject({
			projectId: PROJECT_B,
			projectTitle: 'Kitchen',
			sessionId: SESSION_B1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_B, SESSION_B1)
		});

		expect(request.editPrompt).toBe('');
	});

	it('never closes the scratch tab, even when it is the active tab', () => {
		workspaceTabs.close(SCRATCH_TAB_ID);

		expect(workspaceTabs.tabs).toEqual([
			{ id: SCRATCH_TAB_ID, title: null, sessionTabs: [], activeSessionTabId: null }
		]);
		expect(workspaceTabs.activeTabId).toBe(SCRATCH_TAB_ID);
	});

	it('closing the last project tab falls back to the scratch tab, restoring its state', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A1);
				state.setEditPrompt('project A prompt');
			}
		});

		workspaceTabs.close(PROJECT_A);

		expect(workspaceTabs.tabs).toEqual([
			{ id: SCRATCH_TAB_ID, title: null, sessionTabs: [], activeSessionTabId: null }
		]);
		expect(workspaceTabs.activeTabId).toBe(SCRATCH_TAB_ID);
		expect(request.projectId).toBeUndefined();
		expect(request.editPrompt).toBe('');
	});
});

describe('workspaceTabs.resetAll', () => {
	it('closes every tab — including other, currently-inactive ones — and wipes their frozen drafts', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_A, SESSION_A1);
				state.setEditPrompt('project A prompt');
			}
		});
		workspaceTabs.openProject({
			projectId: PROJECT_B,
			projectTitle: 'Kitchen',
			sessionId: SESSION_B1,
			sessionTitle: null,
			initialize: (state) => {
				state.setProjectSession(PROJECT_B, SESSION_B1);
				state.setEditPrompt('project B prompt');
			}
		});

		// auth.svelte.ts's logout() is the real caller — a signed-out user (or
		// whoever signs in next in the same browser) must never be able to
		// bring project A's draft back by reopening its tab, the way ordinary
		// tab-switching would.
		workspaceTabs.resetAll();

		expect(workspaceTabs.tabs).toEqual([
			{ id: SCRATCH_TAB_ID, title: null, sessionTabs: [], activeSessionTabId: null }
		]);
		expect(workspaceTabs.activeTabId).toBe(SCRATCH_TAB_ID);
		expect(request.projectId).toBeUndefined();
		expect(request.editPrompt).toBe('');

		// Re-opening project A's exact session afterward must rebuild it from
		// scratch (via `initialize`), not thaw a leftover frozen draft.
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		expect(request.editPrompt).toBe('');
	});

	it('clears anything persisted to storage', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		expect(workspaceTabs.readPersisted()).not.toBeNull();

		workspaceTabs.resetAll();

		expect(workspaceTabs.readPersisted()).toBeNull();
	});
});

describe('workspaceTabs persistence', () => {
	it('persists every open tab and the active one after opening, switching, and closing', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: 'Main thread',
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		workspaceTabs.openProject({
			projectId: PROJECT_B,
			projectTitle: 'Kitchen',
			sessionId: SESSION_B1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_B, SESSION_B1)
		});

		let persisted = workspaceTabs.readPersisted();
		expect(persisted?.activeTabId).toBe(PROJECT_B);
		expect(persisted?.tabs.map((tab) => tab.id)).toEqual([PROJECT_A, PROJECT_B]);

		workspaceTabs.activate(PROJECT_A);
		persisted = workspaceTabs.readPersisted();
		expect(persisted?.activeTabId).toBe(PROJECT_A);

		workspaceTabs.close(PROJECT_B);
		persisted = workspaceTabs.readPersisted();
		expect(persisted?.tabs.map((tab) => tab.id)).toEqual([PROJECT_A]);
	});

	it('clears persisted state once every tab is closed', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		expect(workspaceTabs.readPersisted()).not.toBeNull();

		workspaceTabs.close(PROJECT_A);

		expect(workspaceTabs.readPersisted()).toBeNull();
	});

	it('persists nested session tabs and survives a retarget', () => {
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A1,
			sessionTitle: 'Main thread',
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A1)
		});
		workspaceTabs.openProject({
			projectId: PROJECT_A,
			projectTitle: 'Living room',
			sessionId: SESSION_A2,
			sessionTitle: null,
			initialize: (state) => state.setProjectSession(PROJECT_A, SESSION_A2)
		});

		let persisted = workspaceTabs.readPersisted();
		expect(persisted?.tabs[0]?.sessionTabs.map((session) => session.id)).toEqual([
			SESSION_A1,
			SESSION_A2
		]);
		expect(persisted?.tabs[0]?.activeSessionTabId).toBe(SESSION_A2);

		workspaceTabs.retargetSession(SESSION_A2, SESSION_B1);
		persisted = workspaceTabs.readPersisted();
		expect(persisted?.tabs[0]?.sessionTabs.map((session) => session.id)).toEqual([
			SESSION_A1,
			SESSION_B1
		]);
		expect(persisted?.tabs[0]?.activeSessionTabId).toBe(SESSION_B1);
	});

	it('returns null for missing, malformed, or invalid-shaped storage instead of throwing', () => {
		expect(workspaceTabs.readPersisted()).toBeNull();

		localStorage.setItem('cadbos.workspace-tabs.v1', 'not json');
		expect(workspaceTabs.readPersisted()).toBeNull();

		localStorage.setItem('cadbos.workspace-tabs.v1', JSON.stringify({ nonsense: true }));
		expect(workspaceTabs.readPersisted()).toBeNull();
	});
});

// restorePersistedTabs() caches its result for the page's lifetime (see its
// own comment), so each of these gets a fresh module graph via
// vi.resetModules() — otherwise the second test here would just observe the
// first test's already-resolved restore and never call fetch again.
describe('restorePersistedTabs', () => {
	function projectDetailFixture(
		id: string,
		title: string,
		sessions: { id: string; title: string }[]
	) {
		return {
			id,
			title,
			createdAt: 0,
			updatedAt: 0,
			shareActive: false,
			sessions: sessions.map((session) => ({
				id: session.id,
				title: session.title,
				parentSessionId: null,
				forkedFromGenerationId: null,
				createdAt: 0,
				updatedAt: 0,
				generations: []
			}))
		};
	}

	function jsonResponse(body: unknown): Response {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	it('reopens every persisted tab and restores the previously active one', async () => {
		vi.resetModules();
		const fresh = await import('$lib/state/workspace-tabs.svelte');

		localStorage.setItem(
			'cadbos.workspace-tabs.v1',
			JSON.stringify({
				tabs: [
					{
						id: PROJECT_A,
						title: 'Living room',
						sessionTabs: [{ id: SESSION_A1, title: null }],
						activeSessionTabId: SESSION_A1
					},
					{
						id: PROJECT_B,
						title: 'Kitchen',
						sessionTabs: [{ id: SESSION_B1, title: null }],
						activeSessionTabId: SESSION_B1
					}
				],
				activeTabId: PROJECT_A
			})
		);

		const fetchMock = vi.fn<typeof fetch>((input) => {
			const url = String(input);
			if (url.includes(PROJECT_A)) {
				return Promise.resolve(
					jsonResponse(
						projectDetailFixture(PROJECT_A, 'Living room', [{ id: SESSION_A1, title: '' }])
					)
				);
			}
			return Promise.resolve(
				jsonResponse(projectDetailFixture(PROJECT_B, 'Kitchen', [{ id: SESSION_B1, title: '' }]))
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		await fresh.restorePersistedTabs();

		expect(fresh.workspaceTabs.tabs.map((tab) => tab.id)).toEqual([
			SCRATCH_TAB_ID,
			PROJECT_A,
			PROJECT_B
		]);
		expect(fresh.workspaceTabs.activeTabId).toBe(PROJECT_A);
		expect(fresh.workspaceTabs.activeTab.activeSessionTabId).toBe(SESSION_A1);
	});

	it('skips a project that no longer loads (deleted/unowned) without losing the others', async () => {
		vi.resetModules();
		const fresh = await import('$lib/state/workspace-tabs.svelte');

		localStorage.setItem(
			'cadbos.workspace-tabs.v1',
			JSON.stringify({
				tabs: [
					{
						id: PROJECT_A,
						title: 'Living room',
						sessionTabs: [{ id: SESSION_A1, title: null }],
						activeSessionTabId: SESSION_A1
					},
					{
						id: PROJECT_B,
						title: 'Kitchen',
						sessionTabs: [{ id: SESSION_B1, title: null }],
						activeSessionTabId: SESSION_B1
					}
				],
				activeTabId: PROJECT_B
			})
		);

		const fetchMock = vi.fn<typeof fetch>((input) => {
			const url = String(input);
			if (url.includes(PROJECT_A)) return Promise.resolve(new Response(null, { status: 404 }));
			return Promise.resolve(
				jsonResponse(projectDetailFixture(PROJECT_B, 'Kitchen', [{ id: SESSION_B1, title: '' }]))
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		await fresh.restorePersistedTabs();

		expect(fresh.workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_B]);
		expect(fresh.workspaceTabs.activeTabId).toBe(PROJECT_B);
	});

	it('is a no-op with nothing persisted', async () => {
		vi.resetModules();
		const fresh = await import('$lib/state/workspace-tabs.svelte');
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);

		await fresh.restorePersistedTabs();

		expect(fresh.workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
