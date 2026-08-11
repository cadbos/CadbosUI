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

import { afterEach, describe, expect, it } from 'vitest';
import { request } from '$lib/state/request.svelte';
import { SCRATCH_TAB_ID, workspaceTabs } from '$lib/state/workspace-tabs.svelte';

const PROJECT_A = '00000000-0000-4000-8000-000000000001';
const PROJECT_B = '00000000-0000-4000-8000-000000000002';

afterEach(() => {
	// Reset back to a single scratch tab so state doesn't leak between tests.
	while (workspaceTabs.tabs.length > 1) {
		workspaceTabs.close(workspaceTabs.tabs[workspaceTabs.tabs.length - 1].id);
	}
	if (workspaceTabs.tabs[0]?.id !== SCRATCH_TAB_ID) {
		workspaceTabs.close(workspaceTabs.tabs[0].id);
	}
	request.reset();
});

describe('workspaceTabs.openProject', () => {
	it('opens a new tab, activates it, and initializes its request state', () => {
		workspaceTabs.openProject(PROJECT_A, 'Living room', (state) => {
			state.setProjectSession(PROJECT_A, 'session-a');
			state.setEditPrompt('warm living room');
		});

		expect(workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_A]);
		expect(workspaceTabs.activeTabId).toBe(PROJECT_A);
		expect(request.projectId).toBe(PROJECT_A);
		expect(request.editPrompt).toBe('warm living room');
	});

	it('keeps each open project tab independent when switching between them', () => {
		workspaceTabs.openProject(PROJECT_A, 'Living room', (state) => {
			state.setProjectSession(PROJECT_A, 'session-a');
			state.setEditPrompt('project A prompt');
		});
		workspaceTabs.openProject(PROJECT_B, 'Kitchen', (state) => {
			state.setProjectSession(PROJECT_B, 'session-b');
			state.setEditPrompt('project B prompt');
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

	it('re-opening an already-open project reuses its tab and re-initializes in place', () => {
		workspaceTabs.openProject(PROJECT_A, 'Living room', (state) => {
			state.setProjectSession(PROJECT_A, 'session-a');
			state.setEditPrompt('first visit');
		});
		workspaceTabs.openProject(PROJECT_B, 'Kitchen', (state) => {
			state.setProjectSession(PROJECT_B, 'session-b');
		});

		workspaceTabs.openProject(PROJECT_A, 'Living room', (state) => {
			state.setProjectSession(PROJECT_A, 'other-session');
			state.setEditPrompt('second visit');
		});

		expect(workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_A, PROJECT_B]);
		expect(request.projectId).toBe(PROJECT_A);
		expect(request.sessionId).toBe('other-session');
		expect(request.editPrompt).toBe('second visit');
	});
});

describe('workspaceTabs.activate', () => {
	it('is a no-op for an id that is not an open tab', () => {
		workspaceTabs.openProject(PROJECT_A, 'Living room', (state) => {
			state.setProjectSession(PROJECT_A, 'session-a');
		});

		workspaceTabs.activate('not-open');

		expect(workspaceTabs.activeTabId).toBe(PROJECT_A);
	});
});

describe('workspaceTabs.close', () => {
	it('closing a background tab leaves the active project untouched', () => {
		workspaceTabs.openProject(PROJECT_A, 'Living room', (state) => {
			state.setProjectSession(PROJECT_A, 'session-a');
		});
		workspaceTabs.openProject(PROJECT_B, 'Kitchen', (state) => {
			state.setProjectSession(PROJECT_B, 'session-b');
			state.setEditPrompt('project B prompt');
		});

		workspaceTabs.close(PROJECT_A);

		expect(workspaceTabs.tabs.map((tab) => tab.id)).toEqual([SCRATCH_TAB_ID, PROJECT_B]);
		expect(workspaceTabs.activeTabId).toBe(PROJECT_B);
		expect(request.editPrompt).toBe('project B prompt');
	});

	it('closing the active tab falls back to a neighboring tab, restoring its state', () => {
		workspaceTabs.openProject(PROJECT_A, 'Living room', (state) => {
			state.setProjectSession(PROJECT_A, 'session-a');
			state.setEditPrompt('project A prompt');
		});
		workspaceTabs.openProject(PROJECT_B, 'Kitchen', (state) => {
			state.setProjectSession(PROJECT_B, 'session-b');
		});

		workspaceTabs.close(PROJECT_B);

		expect(workspaceTabs.activeTabId).toBe(PROJECT_A);
		expect(request.projectId).toBe(PROJECT_A);
		expect(request.editPrompt).toBe('project A prompt');
	});

	it('closing the last remaining tab resets to a pristine scratch tab', () => {
		workspaceTabs.openProject(PROJECT_A, 'Living room', (state) => {
			state.setProjectSession(PROJECT_A, 'session-a');
			state.setEditPrompt('project A prompt');
		});
		workspaceTabs.close(SCRATCH_TAB_ID);

		workspaceTabs.close(PROJECT_A);

		expect(workspaceTabs.tabs).toEqual([{ id: SCRATCH_TAB_ID, title: null }]);
		expect(workspaceTabs.activeTabId).toBe(SCRATCH_TAB_ID);
		expect(request.projectId).toBeUndefined();
		expect(request.editPrompt).toBe('');
	});
});
