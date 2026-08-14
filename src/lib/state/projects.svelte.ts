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
import type { ProjectRecord } from '$lib/api/contract';

export type ProjectsStatus = 'idle' | 'loading' | 'ready' | 'error';

const PAGE_SIZE = 20;

const projectRecordSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	createdAt: z.number().int().min(0),
	updatedAt: z.number().int().min(0)
});

const projectsResponseSchema = z.object({
	projects: z.array(projectRecordSchema),
	pagination: z.object({
		offset: z.number().int().min(0),
		size: z.number().int().min(1),
		hasMore: z.boolean()
	})
});

export class ProjectsLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProjectsLoadError';
	}
}

export class ProjectCreateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProjectCreateError';
	}
}

export class ProjectArchiveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProjectArchiveError';
	}
}

class ProjectsState {
	projects = $state.raw<ProjectRecord[]>([]);
	status = $state<ProjectsStatus>('idle');
	error = $state<string | null>(null);
	hasMore = $state(false);
	loadingMore = $state(false);
	creating = $state(false);
	// Only ever one card's archive action in flight at a time from the UI.
	archivingId = $state<string | null>(null);
	#abort: AbortController | null = null;
	#nextOffset: number | null = null;

	async load(): Promise<void> {
		this.#abort?.abort();
		const controller = new AbortController();
		this.#abort = controller;
		this.status = 'loading';
		this.error = null;
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;

		try {
			const page = await this.#fetchPage(0, controller.signal);
			if (this.#abort !== controller) return;
			this.projects = page.projects;
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.projects = [];
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'ProjectsLoadError';
			this.hasMore = false;
			this.#nextOffset = null;
			console.error('Projects load failed:', error);
		} finally {
			if (this.#abort === controller) this.#abort = null;
		}
	}

	async loadMore(): Promise<void> {
		if (!this.hasMore || this.loadingMore || this.#nextOffset === null) return;

		const controller = new AbortController();
		const offset = this.#nextOffset;
		this.#abort = controller;
		this.loadingMore = true;
		this.error = null;

		try {
			const page = await this.#fetchPage(offset, controller.signal);
			if (this.#abort !== controller) return;
			this.projects = [...this.projects, ...page.projects];
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'ProjectsLoadError';
			console.error('Projects load more failed:', error);
		} finally {
			if (this.#abort === controller) this.#abort = null;
			this.loadingMore = false;
		}
	}

	// Creates a project on the server and appends it to the in-memory list —
	// listProjects orders by updated_at ASC, and a freshly created project is
	// always the most recently updated one, so this matches what a reload
	// would show without an extra round-trip.
	async create(title: string): Promise<ProjectRecord> {
		this.creating = true;
		try {
			const response = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title })
			});
			if (!response.ok) throw new ProjectCreateError('project creation failed');

			const parsed = projectRecordSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new ProjectCreateError('project creation response invalid');

			this.projects = [...this.projects, parsed.data];
			return parsed.data;
		} finally {
			this.creating = false;
		}
	}

	// Soft delete (projects.ts's archiveProject) — removes it from the
	// in-memory list; its sessions/generations are untouched server-side.
	async archive(id: string): Promise<void> {
		this.archivingId = id;
		try {
			const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
			if (!response.ok) throw new ProjectArchiveError('project archive failed');

			this.projects = this.projects.filter((project) => project.id !== id);
		} finally {
			this.archivingId = null;
		}
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.projects = [];
		this.status = 'idle';
		this.error = null;
		this.hasMore = false;
		this.loadingMore = false;
		this.creating = false;
		this.archivingId = null;
		this.#nextOffset = null;
	}

	async #fetchPage(
		offset: number,
		signal: AbortSignal
	): Promise<z.infer<typeof projectsResponseSchema>> {
		const response = await fetch(`/api/projects?offset=${offset}&size=${PAGE_SIZE}`, { signal });
		if (!response.ok) throw new ProjectsLoadError('projects request failed');

		const parsed = projectsResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new ProjectsLoadError('projects response invalid');
		return parsed.data;
	}

	#setNextPage(page: z.infer<typeof projectsResponseSchema>): void {
		if (page.pagination.hasMore && page.projects.length === 0) {
			throw new ProjectsLoadError('projects pagination did not advance');
		}

		this.#nextOffset = page.pagination.hasMore
			? page.pagination.offset + page.projects.length
			: null;
		this.hasMore = this.#nextOffset !== null;
	}
}

export const projects = new ProjectsState();
