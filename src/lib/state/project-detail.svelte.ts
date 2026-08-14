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

export type ProjectDetailStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not-found';
export type ShareStatus = 'idle' | 'issuing' | 'active' | 'revoking' | 'error';

const sessionGenerationSchema = z.object({
	id: z.uuid(),
	url: z.url(),
	sourceUrl: z.url(),
	kind: z.enum(generationKinds),
	createdAt: z.number().int().min(0)
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
const issueShareResponseSchema = z.object({ token: z.string().min(1) });

export class ProjectDetailLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProjectDetailLoadError';
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
	shareStatus = $state<ShareStatus>('idle');
	// Only known right after issuing — see issueShare(). project.shareActive
	// (loaded from the server) is the source of truth for whether a link
	// exists at all; this is purely the plaintext value for copying.
	shareToken = $state<string | null>(null);
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
	// Shared by issueShare/revokeShare — they're mutually exclusive states of
	// the same share link, so whichever of the two started most recently is
	// the one allowed to write shareToken/shareStatus/project.shareActive. A
	// stale issueShare response arriving after a revokeShare already ran would
	// otherwise resurrect a token the user just revoked.
	#shareCall = 0;

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
			const response = await fetch(`/api/projects/${id}`, { signal: controller.signal });
			if (this.#abort !== controller) return;
			if (response.status === 404) {
				this.project = null;
				this.status = 'not-found';
				return;
			}
			if (!response.ok) throw new ProjectDetailLoadError('project detail request failed');

			const parsed = projectDetailSchema.safeParse(await response.json().catch(() => null));
			if (this.#abort !== controller) return;
			if (!parsed.success) throw new ProjectDetailLoadError('project detail response invalid');

			this.project = parsed.data;
			this.shareToken = null;
			this.shareStatus = parsed.data.shareActive ? 'active' : 'idle';
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

	// The token is only ever known at issuance — GET /api/projects/[id] never
	// returns it (see projects.ts) — so this is the only way the owner sees
	// the plaintext link, same as an API key reveal-once flow.
	async issueShare(): Promise<string> {
		const project = this.project;
		if (!project) throw new ProjectDetailActionError('no project loaded');
		const call = ++this.#shareCall;
		this.shareStatus = 'issuing';
		try {
			const response = await fetch(`/api/projects/${project.id}/share`, { method: 'POST' });
			if (!response.ok) throw new ProjectDetailActionError('share link creation failed');

			const parsed = issueShareResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new ProjectDetailActionError('share link response invalid');

			// A token belonging to a project the user has since navigated away
			// from — or a share operation since superseded by a newer one, e.g.
			// a revoke that started after this issue and has already run — must
			// never surface as if it were the *current* page's link.
			const current = this.#currentProjectIfUnchanged(project);
			if (current && this.#shareCall === call) {
				this.shareToken = parsed.data.token;
				this.shareStatus = 'active';
				this.project = { ...current, shareActive: true };
			}
			return parsed.data.token;
		} catch (error) {
			if (this.#currentProjectIfUnchanged(project) && this.#shareCall === call) {
				this.shareStatus = 'error';
			}
			throw error;
		}
	}

	// Always revokes whichever link is currently active — the caller never
	// needs to have kept the token value (see revokeActiveShareToken).
	async revokeShare(): Promise<void> {
		const project = this.project;
		if (!project) return;
		const call = ++this.#shareCall;
		this.shareStatus = 'revoking';
		try {
			const response = await fetch(`/api/projects/${project.id}/share`, { method: 'DELETE' });
			if (!response.ok && response.status !== 404) {
				throw new ProjectDetailActionError('share link revoke failed');
			}
			const current = this.#currentProjectIfUnchanged(project);
			if (current && this.#shareCall === call) {
				this.shareToken = null;
				this.shareStatus = 'idle';
				this.project = { ...current, shareActive: false };
			}
		} catch (error) {
			if (this.#currentProjectIfUnchanged(project) && this.#shareCall === call) {
				this.shareStatus = 'error';
			}
			throw error;
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
		this.shareStatus = 'idle';
		this.shareToken = null;
	}
}

export const projectDetail = new ProjectDetailState();
