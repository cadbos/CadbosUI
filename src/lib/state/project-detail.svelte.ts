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
		this.renaming = true;
		try {
			const response = await fetch(`/api/projects/${project.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title })
			});
			if (!response.ok) throw new ProjectDetailActionError('project rename failed');

			const body = (await response.json()) as { title: string; updatedAt: number };
			this.project = { ...project, title: body.title, updatedAt: body.updatedAt };
		} finally {
			this.renaming = false;
		}
	}

	// New session has no lineage and no generations yet — its shape is fully
	// known client-side, so it's prepended without a round-trip reload. It's
	// also always the most recently updated session, matching the server's own
	// updated_at DESC ordering.
	async createSession(title?: string): Promise<ProjectSessionRecord> {
		const project = this.project;
		if (!project) throw new ProjectDetailActionError('no project loaded');
		this.creatingSession = true;
		try {
			const response = await fetch(`/api/projects/${project.id}/sessions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(title ? { title } : {})
			});
			if (!response.ok) throw new ProjectDetailActionError('session creation failed');

			const body = (await response.json()) as {
				id: string;
				title: string;
				createdAt: number;
				updatedAt: number;
			};
			const session: ProjectSessionRecord = {
				id: body.id,
				title: body.title,
				parentSessionId: null,
				forkedFromGenerationId: null,
				createdAt: body.createdAt,
				updatedAt: body.updatedAt,
				generations: []
			};
			this.project = { ...project, sessions: [session, ...project.sessions] };
			return session;
		} finally {
			this.creatingSession = false;
		}
	}

	// The token is only ever known at issuance — GET /api/projects/[id] never
	// returns it (see projects.ts) — so this is the only way the owner sees
	// the plaintext link, same as an API key reveal-once flow.
	async issueShare(): Promise<string> {
		const project = this.project;
		if (!project) throw new ProjectDetailActionError('no project loaded');
		this.shareStatus = 'issuing';
		try {
			const response = await fetch(`/api/projects/${project.id}/share`, { method: 'POST' });
			if (!response.ok) throw new ProjectDetailActionError('share link creation failed');

			const body = (await response.json()) as { token: string };
			this.shareToken = body.token;
			this.shareStatus = 'active';
			return body.token;
		} catch (error) {
			this.shareStatus = 'error';
			throw error;
		}
	}

	// Always revokes whichever link is currently active — the caller never
	// needs to have kept the token value (see revokeActiveShareToken).
	async revokeShare(): Promise<void> {
		const project = this.project;
		if (!project) return;
		this.shareStatus = 'revoking';
		try {
			const response = await fetch(`/api/projects/${project.id}/share`, { method: 'DELETE' });
			if (!response.ok && response.status !== 404) {
				throw new ProjectDetailActionError('share link revoke failed');
			}
			this.shareToken = null;
			this.shareStatus = 'idle';
			this.project = { ...project, shareActive: false };
		} catch (error) {
			this.shareStatus = 'error';
			throw error;
		}
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		const project = this.project;
		if (!project) return;
		this.renamingSessionId = sessionId;
		try {
			const response = await fetch(`/api/projects/${project.id}/sessions/${sessionId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title })
			});
			if (!response.ok) throw new ProjectDetailActionError('session rename failed');

			const body = (await response.json()) as { title: string; updatedAt: number };
			this.project = {
				...project,
				sessions: project.sessions.map((session) =>
					session.id === sessionId
						? { ...session, title: body.title, updatedAt: body.updatedAt }
						: session
				)
			};
		} finally {
			this.renamingSessionId = null;
		}
	}

	// Soft delete — see projects.ts's archiveSession. Removes the session from
	// the in-memory list; its generations are untouched server-side.
	async archiveSession(sessionId: string): Promise<void> {
		const project = this.project;
		if (!project) return;
		this.archivingSessionId = sessionId;
		try {
			const response = await fetch(`/api/projects/${project.id}/sessions/${sessionId}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new ProjectDetailActionError('session archive failed');

			this.project = {
				...project,
				sessions: project.sessions.filter((session) => session.id !== sessionId)
			};
		} finally {
			this.archivingSessionId = null;
		}
	}

	// Soft delete — see projects.ts's archiveProject. The caller is
	// responsible for navigating away afterwards (the project page has
	// nothing left to show once its own project is archived).
	async archiveProject(): Promise<void> {
		const project = this.project;
		if (!project) return;
		this.archivingProject = true;
		try {
			const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
			if (!response.ok) throw new ProjectDetailActionError('project archive failed');
		} finally {
			this.archivingProject = false;
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
