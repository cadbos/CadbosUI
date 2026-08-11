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

import { request, RequestState } from '$lib/state/request.svelte';

export interface WorkspaceTab {
	id: string;
	// null shows the "untitled" placeholder — resolved to a translated string
	// at render time (WorkspaceTabBar.svelte), never baked into state here.
	title: string | null;
}

// The always-present tab for work that isn't (yet) attached to a chosen
// project — mirrors RequestState.ensureProjectSession()'s own "Untitled"
// lazy-create convention. Its id is a fixed sentinel, never a real project id.
export const SCRATCH_TAB_ID = 'scratch';

const MAX_TABS = 8;

// Browser-tab-style workspace state: each open project keeps its own
// RequestState so switching between them is instant and lossless — uploaded
// photo, prompt, generation results, in-flight job ids, everything. The
// active tab's data always lives directly in the shared `request` singleton
// (every workspace component already reads that one instance); inactive
// tabs' data is frozen into `#frozen` via RequestState.copyFrom() and thawed
// back on activation. Switching tabs never navigates — only the underlying
// data swaps, so whatever render/edit/styleTransfer route the user is
// already on keeps showing, now backed by the newly active tab's data.
class WorkspaceTabsState {
	tabs = $state<WorkspaceTab[]>([{ id: SCRATCH_TAB_ID, title: null }]);
	activeTabId = $state<string>(SCRATCH_TAB_ID);
	#frozen = new Map<string, RequestState>();

	activate(tabId: string): void {
		if (tabId === this.activeTabId) return;
		if (!this.tabs.some((tab) => tab.id === tabId)) return;

		let outgoing = this.#frozen.get(this.activeTabId);
		if (!outgoing) {
			outgoing = new RequestState();
			this.#frozen.set(this.activeTabId, outgoing);
		}
		outgoing.copyFrom(request);

		this.activeTabId = tabId;
		const incoming = this.#frozen.get(tabId);
		if (incoming) {
			request.copyFrom(incoming);
			this.#frozen.delete(tabId);
		}
	}

	// Opens (or re-opens) the tab for `projectId`, running `initialize` against
	// whichever RequestState instance will end up holding its data — the live
	// singleton if it's already the active tab, its cold-storage instance
	// otherwise — then activates it. `initialize` is the same field-setting
	// logic continueSession (projects/[id]/+page.svelte) already runs today,
	// just targeting the instance it's handed instead of the module singleton
	// directly.
	openProject(projectId: string, title: string, initialize: (state: RequestState) => void): void {
		const existingIndex = this.tabs.findIndex((tab) => tab.id === projectId);
		if (existingIndex === -1) {
			this.#evictOldestInactiveIfAtCapacity();
			this.tabs = [...this.tabs, { id: projectId, title }];
		} else {
			this.tabs = this.tabs.with(existingIndex, { id: projectId, title });
		}

		if (projectId === this.activeTabId) {
			initialize(request);
			return;
		}

		const state = this.#frozen.get(projectId) ?? new RequestState();
		initialize(state);
		this.#frozen.set(projectId, state);
		this.activate(projectId);
	}

	close(tabId: string): void {
		const index = this.tabs.findIndex((tab) => tab.id === tabId);
		if (index === -1) return;

		this.tabs = this.tabs.filter((tab) => tab.id !== tabId);
		this.#frozen.delete(tabId);

		if (tabId !== this.activeTabId) return;

		const next = this.tabs[index] ?? this.tabs[index - 1];
		if (!next) {
			// No tabs left — recreate the scratch tab and reset the live
			// singleton to a pristine state rather than leaving zero tabs.
			request.reset();
			this.tabs = [{ id: SCRATCH_TAB_ID, title: null }];
			this.activeTabId = SCRATCH_TAB_ID;
			return;
		}

		this.activeTabId = next.id;
		const incoming = this.#frozen.get(next.id);
		if (incoming) {
			request.copyFrom(incoming);
			this.#frozen.delete(next.id);
		}
	}

	// Evicts the oldest tab that isn't the active one once the cap is
	// exceeded — same simple bound the earlier project-visited-tabs store
	// used, just applied to live workspace tabs now.
	#evictOldestInactiveIfAtCapacity(): void {
		if (this.tabs.length < MAX_TABS) return;
		const evictIndex = this.tabs.findIndex((tab) => tab.id !== this.activeTabId);
		if (evictIndex === -1) return;
		const evicted = this.tabs[evictIndex];
		this.tabs = this.tabs.filter((_, index) => index !== evictIndex);
		this.#frozen.delete(evicted.id);
	}
}

export const workspaceTabs = new WorkspaceTabsState();
