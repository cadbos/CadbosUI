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

import { SvelteSet } from 'svelte/reactivity';
import { z } from 'zod';
import {
	generationKinds,
	mediaAccessSchema,
	type SceneFilterProject,
	type SceneRecord,
	type SceneView
} from '$lib/api/contract';
import { mediaAccess } from '$lib/state/media-access.svelte';

export type GeneratedImagesStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SceneFilterState {
	view: SceneView;
	projectId: string | null;
	sessionId: string | null;
}

const DEFAULT_FILTER: SceneFilterState = { view: 'iterations', projectId: null, sessionId: null };

const PAGE_SIZE = 100;

const generatedImageRecordSchema = z.object({
	id: z.string().min(1),
	image: mediaAccessSchema,
	source: mediaAccessSchema,
	kind: z.enum(generationKinds),
	createdAt: z.number().int().min(0),
	session: z
		.object({
			projectId: z.uuid(),
			projectTitle: z.string(),
			sessionId: z.uuid(),
			sessionTitle: z.string()
		})
		.nullable(),
	iteration: z.number().int().min(1).nullable(),
	number: z.number().int().min(1),
	sourceGeneration: z
		.object({
			id: z.string().min(1),
			kind: z.enum(generationKinds)
		})
		.nullable()
		.default(null)
});

const generatedImagesResponseSchema = z.object({
	images: z.array(generatedImageRecordSchema),
	pagination: z.object({
		offset: z.number().int().min(0),
		size: z.number().int().min(1),
		hasMore: z.boolean()
	})
});

const sceneFilterOptionsResponseSchema = z.object({
	projects: z.array(
		z.object({
			projectId: z.uuid(),
			projectTitle: z.string(),
			sessions: z.array(z.object({ sessionId: z.uuid(), sessionTitle: z.string() })).min(1)
		})
	)
});

class GeneratedImagesLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GeneratedImagesLoadError';
	}
}

class GeneratedImagesDeleteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GeneratedImagesDeleteError';
	}
}

class SceneFilterOptionsLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SceneFilterOptionsLoadError';
	}
}

function sortLatestFirst(images: SceneRecord[]): SceneRecord[] {
	return [...images].sort((left, right) => {
		const createdAtOrder = right.createdAt - left.createdAt;
		return createdAtOrder === 0 ? right.id.localeCompare(left.id) : createdAtOrder;
	});
}

class GeneratedImagesState {
	images = $state.raw<SceneRecord[]>([]);
	// Every load()/loadMore() — including the reloads after each generation —
	// pages through whatever the Scenes filter currently selects.
	filter = $state.raw<SceneFilterState>(DEFAULT_FILTER);
	filterProjects = $state.raw<SceneFilterProject[]>([]);
	filterOptionsStatus = $state<GeneratedImagesStatus>('idle');
	status = $state<GeneratedImagesStatus>('idle');
	error = $state<string | null>(null);
	deleteFailed = $state(false);
	hasMore = $state(false);
	loadingMore = $state(false);
	deletingIds = new SvelteSet<string>();
	#abort: AbortController | null = null;
	#filterOptionsAbort: AbortController | null = null;
	#nextOffset: number | null = null;

	setFilter(filter: SceneFilterState): void {
		this.filter = filter;
		void this.load();
	}

	// Options only change when a generation lands or a project/session is
	// archived, so they're refreshed whenever Scenes opens. A selection whose
	// project or session is no longer offered falls back to everything.
	async loadFilterOptions(): Promise<void> {
		this.#filterOptionsAbort?.abort();
		const controller = new AbortController();
		this.#filterOptionsAbort = controller;
		this.filterOptionsStatus = 'loading';

		try {
			const response = await fetch('/api/generated-images/sessions', {
				signal: controller.signal
			});
			if (!response.ok)
				throw new SceneFilterOptionsLoadError('scene filter options request failed');
			const parsed = sceneFilterOptionsResponseSchema.safeParse(
				await response.json().catch(() => null)
			);
			if (!parsed.success) {
				throw new SceneFilterOptionsLoadError('scene filter options response invalid');
			}
			if (this.#filterOptionsAbort !== controller) return;
			this.filterProjects = parsed.data.projects;
			this.filterOptionsStatus = 'ready';

			const { projectId, sessionId } = this.filter;
			const project = parsed.data.projects.find((candidate) => candidate.projectId === projectId);
			const staleProject = projectId !== null && !project;
			const staleSession =
				sessionId !== null && !project?.sessions.some((session) => session.sessionId === sessionId);
			if (staleProject || staleSession) {
				this.setFilter({
					...this.filter,
					projectId: staleProject ? null : projectId,
					sessionId: null
				});
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			this.filterOptionsStatus = 'error';
			console.error('Scene filter options load failed:', error);
		} finally {
			if (this.#filterOptionsAbort === controller) this.#filterOptionsAbort = null;
		}
	}

	async load(): Promise<void> {
		this.#abort?.abort();
		const controller = new AbortController();
		this.#abort = controller;
		this.status = 'loading';
		this.error = null;
		this.deleteFailed = false;
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;

		try {
			const page = await this.#fetchPage(0, controller.signal);
			if (this.#abort !== controller) return;
			this.images = sortLatestFirst(page.images);
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.images = [];
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'GeneratedImagesLoadError';
			this.hasMore = false;
			this.#nextOffset = null;
			console.error('Generated images load failed:', error);
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
			this.images = sortLatestFirst([...this.images, ...page.images]);
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'GeneratedImagesLoadError';
			console.error('Generated images load more failed:', error);
		} finally {
			if (this.#abort === controller) this.#abort = null;
			this.loadingMore = false;
		}
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.#filterOptionsAbort?.abort();
		this.#filterOptionsAbort = null;
		this.images = [];
		this.filter = DEFAULT_FILTER;
		this.filterProjects = [];
		this.filterOptionsStatus = 'idle';
		this.status = 'idle';
		this.error = null;
		this.deleteFailed = false;
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;
		this.deletingIds.clear();
	}

	async deleteImage(id: string): Promise<void> {
		if (this.deletingIds.has(id)) return;

		this.deleteFailed = false;
		this.error = null;
		this.deletingIds.add(id);

		try {
			const response = await fetch('/api/generated-images', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!response.ok) throw new GeneratedImagesDeleteError('generated image delete failed');

			const deletedLoadedImage = this.images.some((image) => image.id === id);
			this.images = this.images.filter((image) => image.id !== id);
			if (deletedLoadedImage && this.#nextOffset !== null) {
				this.#nextOffset = Math.max(0, this.#nextOffset - 1);
			}
		} catch (error) {
			this.deleteFailed = true;
			this.error = error instanceof Error ? error.name : 'GeneratedImagesDeleteError';
			console.error('Generated image delete failed:', error);
		} finally {
			this.deletingIds.delete(id);
		}
	}

	async #fetchPage(
		offset: number,
		signal: AbortSignal
	): Promise<z.infer<typeof generatedImagesResponseSchema>> {
		const { view, projectId, sessionId } = this.filter;
		const params = new URLSearchParams({
			offset: String(offset),
			size: String(PAGE_SIZE),
			...(view === 'iterations' ? {} : { view }),
			...(projectId ? { projectId } : {}),
			...(sessionId ? { sessionId } : {})
		});
		const response = await fetch(`/api/generated-images?${params}`, { signal });
		if (!response.ok) throw new GeneratedImagesLoadError('generated images request failed');

		const parsed = generatedImagesResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new GeneratedImagesLoadError('generated images response invalid');
		return {
			...parsed.data,
			images: parsed.data.images.map((image) => ({
				...image,
				image: mediaAccess.normalize(image.image),
				source: mediaAccess.normalize(image.source)
			}))
		};
	}

	#setNextPage(page: z.infer<typeof generatedImagesResponseSchema>): void {
		if (page.pagination.hasMore && page.images.length === 0) {
			throw new GeneratedImagesLoadError('generated images pagination did not advance');
		}

		this.#nextOffset = page.pagination.hasMore ? page.pagination.offset + page.images.length : null;
		this.hasMore = this.#nextOffset !== null;
	}
}

export const generatedImages = new GeneratedImagesState();
