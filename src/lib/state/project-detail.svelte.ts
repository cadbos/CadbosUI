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
import { generationKinds } from '$lib/api/contract';
import type { ProjectDetailResponse, ProjectSessionRecord } from '$lib/api/contract';
import { projectShare } from './project-share.svelte';
import { discardBody } from '$lib/utils';

export type ProjectDetailStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not-found';

const sessionGenerationSchema = z.object({
	id: z.uuid(),
	url: z.url(),
	sourceUrl: z.url(),
	kind: z.enum(generationKinds),
	createdAt: z.number().int().min(0),
	amount: z.number(),
	balanceAfter: z.number()
});

const sessionSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	parentSessionId: z.uuid().nullable(),
	forkedFromGenerationId: z.uuid().nullable(),
	createdAt: z.number().int().min(0),
	updatedAt: z.number().int().min(0),
	generations: z.array(sessionGenerationSchema)
});

const projectDetailSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	createdAt: z.number().int().min(0),
	updatedAt: z.number().int().min(0),
	shareActive: z.boolean(),
	sessions: z.array(sessionSchema)
});

// Narrow response schemas for the action methods below — each only asserts
// the fields that method actually reads, same principle as projectDetailSchema
// above but scoped to a single mutation's response instead of the full detail
// payload.
const renameResponseSchema = z.object({ title: z.string(), updatedAt: z.number().int().min(0) });
const createSessionResponseSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	createdAt: z.number().int().min(0),
	updatedAt: z.number().int().min(0)
});

export class ProjectDetailLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProjectDetailLoadError';
	}
}

// A plain, one-off fetch — independent of the ProjectDetailState instance
// below, whose own load() cancels any request already in flight when called
// again. Callers that need several projects' details back-to-back (or
// alongside whatever the /projects/[id] page itself is loading), such as
// workspace-tabs.svelte.ts's tab restore, would otherwise race that shared
// in-flight slot. Null on any failure — 404, network error, malformed body —
// since every caller's response is "skip this one", not an error to surface.
export async function fetchProjectDetail(id: string): Promise<ProjectDetailResponse | null> {
	try {
		const response = await fetch(`/api/projects/${id}`);
		// A 404 (not found, or not owned by the caller) is an expected,
		// unremarkable outcome here — every caller already treats it as
		// "skip this one" — so only genuine failures are worth logging.
		if (response.status === 404) return null;
		if (!response.ok) {
			console.error('fetchProjectDetail failed:', response.status);
			return null;
		}
		const parsed = projectDetailSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) {
			console.error('fetchProjectDetail: response failed schema validation');
			return null;
		}
		return parsed.data;
	} catch (error) {
		console.error('fetchProjectDetail failed:', error);
		return null;
	}
}

export class ProjectDetailActionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProjectDetailActionError';
	}
}

class ProjectDetailState {
	project = $state<ProjectDetailResponse | null>(null);
	status = $state<ProjectDetailStatus>('idle');
	error = $state<string | null>(null);
	renaming = $state(false);
	creatingSession = $state(false);
	archivingProject = $state(false);
	// Only ever one session action in flight from the UI at a time, so a
	// single id (rather than a Set) is enough to know which card is busy.
	renamingSessionId = $state<string | null>(null);
	archivingSessionId = $state<string | null>(null);
	#abort: AbortController | null = null;

	// One counter per busy flag below — each call increments its own before
	// starting, and its `finally` only clears the flag if no *newer* call for
	// that same operation has started since. Without this, starting a second
	// rename/create/archive (a different project after navigating away with
	// one still in flight, or a different session card — renamingSessionId
	// has no per-session tracking of its own) lets the first call's finally
	// clear a flag a second, still-in-flight call now owns, re-enabling its
	// button before that call has actually finished.
	#renameCall = 0;
	#createSessionCall = 0;
	#archiveProjectCall = 0;
	#renameSessionCall = 0;
	#archiveSessionCall = 0;

	// Guards a mutation's late-arriving response against the project having
	// changed underneath it — the user navigated away, or to a different
	// project's detail page, while the request was still in flight. Returns
	// the *current* project (not the stale one captured before the await) so
	// a merge builds on whatever a concurrent, faster mutation already wrote,
	// or null if it's no longer safe to write at all.
	#currentProjectIfUnchanged(from: ProjectDetailResponse): ProjectDetailResponse | null {
		return this.project && this.project.id === from.id ? this.project : null;
	}

	async load(id: string): Promise<void> {
		this.#abort?.abort();
		const controller = new AbortController();
		this.#abort = controller;
		this.status = 'loading';
		this.error = null;

		try {
			// Fetched alongside the detail request, not after it, even though
			// whether it's needed depends on shareActive (only known once the
			// detail response parses) — a 404 here (no active link) is the common
			// case and cheap, and firing both up front means a share link that's
			// already active shows up ready to copy on the very first paint
			// instead of a beat later.
			const [detailResponse, shareResponse] = await Promise.all([
				fetch(`/api/projects/${id}`, { signal: controller.signal }),
				fetch(`/api/projects/${id}/share`, { signal: controller.signal })
			]);
			if (this.#abort !== controller) {
				discardBody(detailResponse);
				discardBody(shareResponse);
				return;
			}
			if (detailResponse.status === 404) {
				discardBody(shareResponse);
				this.project = null;
				this.status = 'not-found';
				return;
			}
			if (!detailResponse.ok) {
				discardBody(shareResponse);
				throw new ProjectDetailLoadError('project detail request failed');
			}

			const parsed = projectDetailSchema.safeParse(await detailResponse.json().catch(() => null));
			if (this.#abort !== controller) {
				discardBody(shareResponse);
				return;
			}
			if (!parsed.success) {
				discardBody(shareResponse);
				throw new ProjectDetailLoadError('project detail response invalid');
			}

			this.project = parsed.data;
			await projectShare.hydrate(id, parsed.data.shareActive, shareResponse);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.project = null;
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'ProjectDetailLoadError';
			console.error('Project detail load failed:', error);
		} finally {
			if (this.#abort === controller) this.#abort = null;
		}
	}

	async rename(title: string): Promise<void> {
		const project = this.project;
		if (!project) return;
		const call = ++this.#renameCall;
		this.renaming = true;
		try {
			const response = await fetch(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title })
			});
			if (!response.ok) throw new ProjectDetailActionError('project rename failed');

			const parsed = renameResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new ProjectDetailActionError('project rename response invalid');

			const current = this.#currentProjectIfUnchanged(project);
			if (current) {
				this.project = { ...current, title: parsed.data.title, updatedAt: parsed.data.updatedAt };
			}
		} finally {
			if (this.#renameCall === call) this.renaming = false;
		}
	}

	// New session has no lineage and no generations yet — its shape is fully
	// known client-side, so it's appended without a round-trip reload. It's
	// also always the most recently updated session, matching the server's own
	// updated_at ASC ordering.
	async createSession(title?: string): Promise<ProjectSessionRecord> {
		const project = this.project;
		if (!project) throw new ProjectDetailActionError('no project loaded');
		const call = ++this.#createSessionCall;
		this.creatingSession = true;
		try {
			const response = await fetch(`/api/projects/${project.id}/sessions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(title ? { title } : {})
			});
			if (!response.ok) throw new ProjectDetailActionError('session creation failed');

			const parsed = createSessionResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) {
				throw new ProjectDetailActionError('session creation response invalid');
			}
			const session: ProjectSessionRecord = {
				id: parsed.data.id,
				title: parsed.data.title,
				parentSessionId: null,
				forkedFromGenerationId: null,
				createdAt: parsed.data.createdAt,
				updatedAt: parsed.data.updatedAt,
				generations: []
			};
			const current = this.#currentProjectIfUnchanged(project);
			if (current) {
				this.project = { ...current, sessions: [...current.sessions, session] };
			}
			return session;
		} finally {
			if (this.#createSessionCall === call) this.creatingSession = false;
		}
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		const project = this.project;
		if (!project) return;
		const call = ++this.#renameSessionCall;
		this.renamingSessionId = sessionId;
		try {
			const response = await fetch(`/api/projects/${project.id}/sessions/${sessionId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title })
			});
			if (!response.ok) throw new ProjectDetailActionError('session rename failed');

			const parsed = renameResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new ProjectDetailActionError('session rename response invalid');

			const current = this.#currentProjectIfUnchanged(project);
			if (current) {
				this.project = {
					...current,
					sessions: current.sessions.map((session) =>
						session.id === sessionId
							? { ...session, title: parsed.data.title, updatedAt: parsed.data.updatedAt }
							: session
					)
				};
			}
		} finally {
			if (this.#renameSessionCall === call) this.renamingSessionId = null;
		}
	}

	// Soft delete — see projects.ts's archiveSession. Removes the session from
	// the in-memory list; its generations are untouched server-side.
	async archiveSession(sessionId: string): Promise<void> {
		const project = this.project;
		if (!project) return;
		const call = ++this.#archiveSessionCall;
		this.archivingSessionId = sessionId;
		try {
			const response = await fetch(`/api/projects/${project.id}/sessions/${sessionId}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new ProjectDetailActionError('session archive failed');

			const current = this.#currentProjectIfUnchanged(project);
			if (current) {
				this.project = {
					...current,
					sessions: current.sessions.filter((session) => session.id !== sessionId)
				};
			}
		} finally {
			if (this.#archiveSessionCall === call) this.archivingSessionId = null;
		}
	}

	// Soft delete — see projects.ts's archiveProject. The caller is
	// responsible for navigating away afterwards (the project page has
	// nothing left to show once its own project is archived).
	async archiveProject(): Promise<void> {
		const project = this.project;
		if (!project) return;
		const call = ++this.#archiveProjectCall;
		this.archivingProject = true;
		try {
			const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
			if (!response.ok) throw new ProjectDetailActionError('project archive failed');
		} finally {
			if (this.#archiveProjectCall === call) this.archivingProject = false;
		}
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.project = null;
		this.status = 'idle';
		this.error = null;
		this.renaming = false;
		this.creatingSession = false;
		this.archivingProject = false;
		this.renamingSessionId = null;
		this.archivingSessionId = null;
		projectShare.clear();
	}
}

export const projectDetail = new ProjectDetailState();
