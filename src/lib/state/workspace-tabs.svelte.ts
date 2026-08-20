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

import { z } from 'zod';
import type { ProjectSessionRecord, SessionGenerationRecord } from '$lib/api/contract';
import { fetchProjectDetail } from '$lib/state/project-detail.svelte';
import { request, RequestState } from '$lib/state/request.svelte';

// Resets a RequestState to continue the given session — shared by the
// "Continue" button (projects/[id]/+page.svelte) and Workspace.svelte's own
// resolution of a project/session pair carried in the URL (see
// url-state.ts's withProjectSession/projectSessionFromSearch). Callers pass
// this as openProject()'s `initialize`.
export function initializeSessionState(
	state: RequestState,
	projectId: string,
	session: ProjectSessionRecord
): void {
	state.setCurrentRender(undefined);
	state.setProjectSession(projectId, session.id);
	state.setStyleSourceMode('room-photo');
	state.setObjectReplacementSourceMode('room-photo');
	state.setTextureReplacementSourceMode('room-photo');
	state.setTextureMaskImage(undefined);
	state.setActiveObjectReplacementJobId(undefined);
	state.setActiveTextureReplacementJobId(undefined);
	state.setStatus('idle');
	const latest = session.generations[0];
	if (latest) state.setImage({ url: latest.url });
}

// Seeds the workspace with one specific past generation's before/after —
// shared by the /expenses row click and a `?generation=` URL anchor
// (Workspace.svelte's openFromUrl). Unlike initializeSessionState (which
// leaves history empty, ready for a fresh generation), this seeds it with the
// clicked generation as the "after" step: setCurrentRender() derives the
// "before" step automatically from state.image.url (just set to the
// generation's own sourceUrl), the same synthetic-original-step mechanism a
// real first generation gets — so RenderResult.svelte's Compare toggle works
// exactly as if this generation had just happened.
export function initializeGenerationPreview(
	state: RequestState,
	projectId: string,
	session: ProjectSessionRecord,
	generation: SessionGenerationRecord
): void {
	state.setCurrentRender(undefined);
	state.setProjectSession(projectId, session.id);
	state.setStyleSourceMode('room-photo');
	state.setObjectReplacementSourceMode('room-photo');
	state.setTextureReplacementSourceMode('room-photo');
	state.setTextureMaskImage(undefined);
	state.setActiveObjectReplacementJobId(undefined);
	state.setActiveTextureReplacementJobId(undefined);
	state.setStatus('idle');
	state.setImage({ url: generation.sourceUrl });
	state.setCurrentRender({
		id: generation.id,
		outputUrls: [generation.url],
		// Only ever undefined for a generation resolved through the public
		// /share/[token] viewer's response shape, which deliberately strips
		// these — this function is never called on that path today, but stays
		// defensive rather than asserting a value that type isn't guaranteed.
		cost: generation.amount ?? 0,
		balance: generation.balanceAfter ?? 0,
		ts: generation.createdAt
	});
	state.setViewingGenerationId(generation.id);
}

export interface SessionTab {
	id: string;
	// null shows the "untitled" placeholder — resolved to a translated string
	// at render time (SessionTabBar.svelte), never baked into state here.
	title: string | null;
}

export interface WorkspaceTab {
	id: string;
	// null shows the "untitled" placeholder — resolved to a translated string
	// at render time (WorkspaceTabBar.svelte), never baked into state here.
	title: string | null;
	// The project tab's own open/closable sessions — always empty for the
	// scratch tab, since scratch work isn't attached to a project (and so has
	// no session) until RequestState.ensureProjectSession() lazily creates
	// one, a pre-existing wart this layer doesn't attempt to track.
	sessionTabs: SessionTab[];
	// Which of sessionTabs this project tab shows when it becomes active.
	// Always null for the scratch tab.
	activeSessionTabId: string | null;
}

// The always-present tab for work that isn't (yet) attached to a chosen
// project — mirrors RequestState.ensureProjectSession()'s own "Untitled"
// lazy-create convention. Its id is a fixed sentinel, never a real project id.
export const SCRATCH_TAB_ID = 'scratch';

function scratchTab(): WorkspaceTab {
	return { id: SCRATCH_TAB_ID, title: null, sessionTabs: [], activeSessionTabId: null };
}

// Survives a full page reload (the in-memory tabs/#frozen below don't) — just
// enough identity (which projects/sessions were open, in what order, which
// was active) to re-open each one on the next mount. The actual generation
// content is never persisted here: restoring always re-fetches it from the
// server, same as continuing a session from /projects/[id] does today, so
// there's no stale/oversized blob sitting in localStorage.
const STORAGE_KEY = 'cadbos.workspace-tabs.v1';

const persistedSessionTabSchema = z.object({ id: z.string(), title: z.string().nullable() });
const persistedTabSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	sessionTabs: z.array(persistedSessionTabSchema),
	activeSessionTabId: z.string().nullable()
});
const persistedStateSchema = z.object({
	tabs: z.array(persistedTabSchema),
	activeTabId: z.string()
});
export type PersistedWorkspaceTabs = z.infer<typeof persistedStateSchema>;

const renameResponseSchema = z.object({ title: z.string() });

export interface OpenProjectParams {
	projectId: string;
	projectTitle: string;
	sessionId: string;
	sessionTitle: string | null;
	initialize: (state: RequestState) => void;
}

// Browser-tab-style workspace state, two levels deep: each open project keeps
// its own open session tabs, and each *session* tab keeps its own
// RequestState — uploaded photo, prompt, generation results, in-flight job
// ids, everything — so switching between any project/session combination is
// instant and lossless.
//
// Exactly one RequestState is ever "live": the shared `request` singleton
// every workspace component already reads. Which project+session combination
// it currently represents is tracked here as a single flattened `#liveKey` —
// a session id when the active project tab has one, SCRATCH_TAB_ID
// otherwise (scratch never has sessions, so there's no ambiguity). Every
// other open session tab's data sits frozen in `#frozen`, keyed the same way,
// thawed back via RequestState.copyFrom() the moment it becomes live again.
class WorkspaceTabsState {
	tabs = $state<WorkspaceTab[]>([scratchTab()]);
	activeTabId = $state<string>(SCRATCH_TAB_ID);
	#frozen = new Map<string, RequestState>();
	// Tracked explicitly rather than derived from activeTabId/activeSessionTabId
	// at swap time: openProject() below has to update a tab's
	// activeSessionTabId *before* it knows whether that makes the tab's new
	// session the live one, so deriving the outgoing key from current state at
	// swap time would sometimes freeze under the wrong (already-overwritten) key.
	#liveKey: string = SCRATCH_TAB_ID;

	get activeTab(): WorkspaceTab {
		return this.tabs.find((tab) => tab.id === this.activeTabId) ?? this.tabs[0];
	}

	get activeSessionTabs(): SessionTab[] {
		return this.activeTab.sessionTabs;
	}

	// A dangling activeSessionTabId (its session tab was since closed/evicted
	// through a path that didn't also clear the pointer) degrades to the
	// tab's own id instead of thawing nothing.
	#keyFor(tab: WorkspaceTab): string {
		const sessionId = tab.activeSessionTabId;
		return sessionId && tab.sessionTabs.some((session) => session.id === sessionId)
			? sessionId
			: tab.id;
	}

	// Called at the end of every method below that changes `tabs`/`activeTabId`
	// — see the STORAGE_KEY comment above for what this is and isn't for.
	// Guarded for SSR, where localStorage doesn't exist but this module (a
	// singleton, instantiated at import time) still loads.
	#persist(): void {
		if (typeof localStorage === 'undefined') return;
		const openTabs = this.tabs.filter((tab) => tab.id !== SCRATCH_TAB_ID);
		if (openTabs.length === 0) {
			localStorage.removeItem(STORAGE_KEY);
			return;
		}
		const snapshot: PersistedWorkspaceTabs = { tabs: openTabs, activeTabId: this.activeTabId };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
	}

	// Workspace.svelte's restore-on-mount flow (see there) is the only
	// caller — it re-opens each persisted tab through openProject() itself
	// rather than trusting this data as live content, since only tab
	// *identity* (ids/titles) survives a reload; the actual generation/prompt
	// draft always comes back from the server, same as continuing a session
	// from /projects/[id] does today.
	readPersisted(): PersistedWorkspaceTabs | null {
		if (typeof localStorage === 'undefined') return null;
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		try {
			const parsed = persistedStateSchema.safeParse(JSON.parse(raw));
			return parsed.success ? parsed.data : null;
		} catch {
			// Malformed/tampered storage value — untrusted boundary input, not a
			// bug to log (same treatment as a corrupt shared-URL fragment).
			return null;
		}
	}

	// `discardOutgoing` is for closeSession()/close(): when the tab being
	// closed is the live one, its own tabs/sessionTabs entry is already gone
	// by the time this runs, so the usual freeze-before-swap below would
	// recreate a #frozen entry for a tab that no longer exists — orphaned,
	// never released by #releaseFrozen (which only walks *current* tabs), and
	// silently resurrected (stale editPrompt, stale image, everything) if a
	// session ID is ever reused. Closing must discard that state instead.
	#swapTo(nextKey: string, options: { discardOutgoing?: boolean } = {}): void {
		if (nextKey === this.#liveKey) return;

		if (options.discardOutgoing) {
			this.#frozen.delete(this.#liveKey);
		} else {
			let outgoing = this.#frozen.get(this.#liveKey);
			if (!outgoing) {
				outgoing = new RequestState();
				this.#frozen.set(this.#liveKey, outgoing);
			}
			outgoing.copyFrom(request);
		}

		this.#liveKey = nextKey;
		const incoming = this.#frozen.get(nextKey);
		if (incoming) {
			request.copyFrom(incoming);
			this.#frozen.delete(nextKey);
		} else if (options.discardOutgoing) {
			request.reset();
		}
	}

	activate(tabId: string): void {
		if (tabId === this.activeTabId) return;
		const tab = this.tabs.find((candidate) => candidate.id === tabId);
		if (!tab) return;

		this.activeTabId = tabId;
		this.#swapTo(this.#keyFor(tab));
		this.#persist();
	}

	// Switches to a specific session tab, activating its parent project tab
	// too if that isn't already the active one.
	activateSession(projectId: string, sessionId: string): void {
		const tabIndex = this.tabs.findIndex((tab) => tab.id === projectId);
		if (tabIndex === -1) return;
		const tab = this.tabs[tabIndex];
		if (!tab.sessionTabs.some((session) => session.id === sessionId)) return;

		if (tab.activeSessionTabId !== sessionId) {
			this.tabs = this.tabs.with(tabIndex, { ...tab, activeSessionTabId: sessionId });
		}
		this.activeTabId = projectId;
		this.#swapTo(sessionId);
		this.#persist();
	}

	// Opens (or re-opens) the session tab for `sessionId` within the project
	// tab for `projectId` — creating either or both as needed — then activates
	// it. `initialize` is the same field-setting logic continueSession
	// (projects/[id]/+page.svelte) already runs today, just targeting the
	// RequestState instance it's handed instead of the module singleton
	// directly.
	openProject(params: OpenProjectParams): void {
		const { projectId, projectTitle, sessionId, sessionTitle, initialize } = params;

		let tabIndex = this.tabs.findIndex((tab) => tab.id === projectId);
		if (tabIndex === -1) {
			this.tabs = [
				...this.tabs,
				{ id: projectId, title: projectTitle, sessionTabs: [], activeSessionTabId: null }
			];
			tabIndex = this.tabs.length - 1;
		} else if (this.tabs[tabIndex].title !== projectTitle) {
			this.tabs = this.tabs.with(tabIndex, { ...this.tabs[tabIndex], title: projectTitle });
		}

		const tab = this.tabs[tabIndex];
		const sessionIndex = tab.sessionTabs.findIndex((session) => session.id === sessionId);
		const sessionTabs =
			sessionIndex === -1
				? [...tab.sessionTabs, { id: sessionId, title: sessionTitle }]
				: tab.sessionTabs.with(sessionIndex, { id: sessionId, title: sessionTitle });
		this.tabs = this.tabs.with(tabIndex, { ...tab, sessionTabs, activeSessionTabId: sessionId });

		if (sessionId === this.#liveKey) {
			initialize(request);
			this.#persist();
			return;
		}

		const state = this.#frozen.get(sessionId) ?? new RequestState();
		initialize(state);
		this.#frozen.set(sessionId, state);
		this.activeTabId = projectId;
		this.#swapTo(sessionId);
		this.#persist();
	}

	// ensureProjectSession() (request.svelte.ts) can lazily create a real
	// project+session while the scratch tab is live, but only ever tells
	// `request` about it — nothing here learns the scratch tab now represents
	// a real project, so the URL-sync effect (Workspace.svelte) keeps
	// computing activeProjectId/activeSessionId as undefined and the new ids
	// silently never make it into the address bar. Called reactively from
	// Workspace.svelte whenever that happens; a no-op once scratch is no
	// longer the live tab (including on every later call for the same
	// promotion, so callers don't need to guard re-invocation themselves).
	adoptScratchSession(
		projectId: string,
		projectTitle: string,
		sessionId: string,
		sessionTitle: string | null
	): void {
		if (this.#liveKey !== SCRATCH_TAB_ID) return;
		// The scratch tab must stay present and blank for future project-less
		// work — pre-freeze an empty state under its key so switching back to
		// it later doesn't show the content that's being promoted below.
		this.#frozen.set(SCRATCH_TAB_ID, new RequestState());
		this.tabs = [
			...this.tabs,
			{
				id: projectId,
				title: projectTitle,
				sessionTabs: [{ id: sessionId, title: sessionTitle }],
				activeSessionTabId: sessionId
			}
		];
		this.activeTabId = projectId;
		this.#liveKey = sessionId;
		this.#persist();
	}

	// Unlike project-detail.svelte.ts's rename()/renameSession() (which guard
	// re-entrancy with a shared call-token counter), these two don't: that
	// pattern is correct there because that store only ever represents *one*
	// project's detail page at a time, so a single counter can't confuse two
	// unrelated entities. This store manages *many* open tabs at once, so a
	// shared counter would be wrong — renaming project B while project A's
	// request is still in flight would falsely mark A's response as stale and
	// drop a legitimate write, even though A and B don't conflict. The
	// re-entrancy that does need guarding — typing into the *same* tab's
	// rename field twice before the first request resolves — is instead
	// handled by the caller (TabStrip.svelte disables the input while a
	// request for that specific tab is pending), so this layer can stay a
	// plain fetch-validate-apply per call.
	async renameProject(projectId: string, title: string): Promise<void> {
		const response = await fetch(`/api/projects/${projectId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title })
		});
		if (!response.ok) throw new Error('workspace tab project rename failed');
		const parsed = renameResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new Error('workspace tab project rename response invalid');

		// No local tab left to reflect the rename in (closed while the request
		// was in flight) — the rename still succeeded server-side, so this
		// no-ops rather than throwing, same as openProject/retargetSession do
		// for analogous races elsewhere in this file.
		const index = this.tabs.findIndex((tab) => tab.id === projectId);
		if (index === -1) return;
		this.tabs = this.tabs.with(index, { ...this.tabs[index], title: parsed.data.title });
		this.#persist();
	}

	async renameSession(projectId: string, sessionId: string, title: string): Promise<void> {
		const response = await fetch(`/api/projects/${projectId}/sessions/${sessionId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title })
		});
		if (!response.ok) throw new Error('workspace tab session rename failed');
		const parsed = renameResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new Error('workspace tab session rename response invalid');

		const tabIndex = this.tabs.findIndex((tab) => tab.id === projectId);
		if (tabIndex === -1) return;
		const tab = this.tabs[tabIndex];
		const sessionIndex = tab.sessionTabs.findIndex((session) => session.id === sessionId);
		if (sessionIndex === -1) return;
		const sessionTabs = tab.sessionTabs.with(sessionIndex, {
			...tab.sessionTabs[sessionIndex],
			title: parsed.data.title
		});
		this.tabs = this.tabs.with(tabIndex, { ...tab, sessionTabs });
		this.#persist();
	}

	// A style-transfer fork (StyleTransferPanel.svelte) replaces the live
	// session's id mid-flow via request.setProjectSession — called after that,
	// to keep the open session tab (and any frozen state filed under the old
	// id, in the unlikely case the fork wasn't live) pointing at the new one.
	// The session tab keeps its existing title — a fork isn't a rename.
	retargetSession(oldSessionId: string, newSessionId: string): void {
		const tabIndex = this.tabs.findIndex((tab) =>
			tab.sessionTabs.some((session) => session.id === oldSessionId)
		);
		if (tabIndex === -1) return;
		const tab = this.tabs[tabIndex];
		const sessionIndex = tab.sessionTabs.findIndex((session) => session.id === oldSessionId);

		const sessionTabs = tab.sessionTabs.with(sessionIndex, {
			id: newSessionId,
			title: tab.sessionTabs[sessionIndex].title
		});
		const activeSessionTabId =
			tab.activeSessionTabId === oldSessionId ? newSessionId : tab.activeSessionTabId;
		this.tabs = this.tabs.with(tabIndex, { ...tab, sessionTabs, activeSessionTabId });
		this.#persist();

		if (this.#liveKey === oldSessionId) {
			this.#liveKey = newSessionId;
			return;
		}
		const frozen = this.#frozen.get(oldSessionId);
		if (frozen) {
			this.#frozen.delete(oldSessionId);
			this.#frozen.set(newSessionId, frozen);
		}
	}

	// Closes one session tab. A project tab with no sessions left doesn't fit
	// this model, so closing the last one closes the whole project tab too.
	closeSession(projectId: string, sessionId: string): void {
		const tabIndex = this.tabs.findIndex((tab) => tab.id === projectId);
		if (tabIndex === -1) return;
		const tab = this.tabs[tabIndex];
		const sessionIndex = tab.sessionTabs.findIndex((session) => session.id === sessionId);
		if (sessionIndex === -1) return;

		this.#frozen.delete(sessionId);
		const sessionTabs = tab.sessionTabs.filter((session) => session.id !== sessionId);
		if (sessionTabs.length === 0) {
			this.close(projectId);
			return;
		}

		if (tab.activeSessionTabId !== sessionId) {
			this.tabs = this.tabs.with(tabIndex, { ...tab, sessionTabs });
			this.#persist();
			return;
		}

		const nextActiveSessionId = (sessionTabs[sessionIndex] ?? sessionTabs[sessionIndex - 1]).id;
		this.tabs = this.tabs.with(tabIndex, {
			...tab,
			sessionTabs,
			activeSessionTabId: nextActiveSessionId
		});
		this.#swapTo(nextActiveSessionId, { discardOutgoing: true });
		this.#persist();
	}

	close(projectId: string): void {
		// The scratch tab is the always-present home for project-less work
		// (see its own comment above) — closing it would leave no way back to
		// that state short of a full page reload, so closing it is a no-op.
		if (projectId === SCRATCH_TAB_ID) return;

		const index = this.tabs.findIndex((tab) => tab.id === projectId);
		if (index === -1) return;

		this.#releaseFrozen(this.tabs[index]);
		this.tabs = this.tabs.filter((tab) => tab.id !== projectId);

		if (projectId !== this.activeTabId) {
			this.#persist();
			return;
		}

		const next = this.tabs[index] ?? this.tabs[index - 1];
		if (!next) {
			this.resetAll();
			return;
		}

		this.activeTabId = next.id;
		this.#swapTo(this.#keyFor(next), { discardOutgoing: true });
		this.#persist();
	}

	// Closes every open tab and wipes anything frozen or persisted for them,
	// back to a single pristine scratch tab — called above when closing the
	// last tab leaves none, and by auth.svelte.ts on logout. The latter
	// matters even though logout already clears `request` and redirects to
	// signed-out UI: without this, every *other* open tab's frozen
	// RequestState — another project's uploaded photo, prompt, generated
	// images — stays sitting in memory (and in localStorage) and reappears
	// instantly, with no further fetch, for whoever signs in next in the same
	// browser, since nothing here has ever checked that it's still the same
	// account.
	resetAll(): void {
		request.reset();
		this.tabs = [scratchTab()];
		this.activeTabId = SCRATCH_TAB_ID;
		this.#liveKey = SCRATCH_TAB_ID;
		this.#frozen.clear();
		this.#persist();
	}

	#releaseFrozen(tab: WorkspaceTab): void {
		for (const session of tab.sessionTabs) {
			this.#frozen.delete(session.id);
		}
	}
}

export const workspaceTabs = new WorkspaceTabsState();

// Cached so every caller (the root layout's onMount, which runs on every
// route so a reload while on e.g. /projects/[id] still restores tabs before
// any button there can be clicked, and Workspace.svelte's own afterNavigate,
// which needs to know restoration has *finished* before layering the URL's
// project/session on top) shares one in-flight restore instead of racing
// separate ones — the second caller just awaits the first's result.
let restorePromise: Promise<void> | null = null;

async function performRestore(): Promise<void> {
	const persisted = workspaceTabs.readPersisted();
	if (!persisted) return;

	for (const tab of persisted.tabs) {
		const project = await fetchProjectDetail(tab.id);
		if (!project) continue;
		for (const sessionTab of tab.sessionTabs) {
			const session = project.sessions.find((candidate) => candidate.id === sessionTab.id);
			if (!session) continue;
			workspaceTabs.openProject({
				projectId: project.id,
				projectTitle: project.title,
				sessionId: session.id,
				sessionTitle: session.title.trim() === '' ? null : session.title,
				initialize: (state) => initializeSessionState(state, project.id, session)
			});
		}
	}

	// openProject() above always activates whichever tab/session it just
	// opened, so the one that was actually active before reload only ends up
	// active again once every tab has been recreated.
	const activeTab = persisted.tabs.find((tab) => tab.id === persisted.activeTabId);
	if (activeTab?.activeSessionTabId) {
		workspaceTabs.activateSession(activeTab.id, activeTab.activeSessionTabId);
	}
}

// Re-opens every project/session tab that was still open when the page was
// last left (see readPersisted's own doc comment for what does and doesn't
// survive) — otherwise a reload silently collapses everything down to
// whichever single project/session, if any, happens to be in the URL.
// Idempotent for the page's lifetime: only the first call does anything: see
// restorePromise above.
export function restorePersistedTabs(): Promise<void> {
	restorePromise ??= performRestore();
	return restorePromise;
}
