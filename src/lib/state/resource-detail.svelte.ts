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
import {
	generationKinds,
	mediaAccessSchema,
	resourceRoles,
	type MediaAccess,
	type ResourceGenerationRecord,
	type ResourceRole
} from '$lib/api/contract';
import { mediaAccess } from '$lib/state/media-access.svelte';

// 'not-found' is its own state, not an error: the image isn't one of this
// user's resources (or no longer exists), and retrying won't change that.
export type ResourceDetailStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';

const PAGE_SIZE = 30;

const resourceDetailResponseSchema = z.object({
	image: mediaAccessSchema,
	roles: z.array(z.enum(resourceRoles)).min(1),
	generations: z.array(
		z.object({
			id: z.string().min(1),
			kind: z.enum(generationKinds),
			createdAt: z.number().int().min(0),
			image: mediaAccessSchema,
			roles: z.array(z.enum(resourceRoles)),
			session: z
				.object({
					projectId: z.uuid(),
					projectTitle: z.string(),
					sessionId: z.uuid(),
					sessionTitle: z.string()
				})
				.nullable(),
			settingsSaved: z.boolean()
		})
	),
	pagination: z.object({
		offset: z.number().int().min(0),
		size: z.number().int().min(1),
		hasMore: z.boolean()
	})
});

type ResourceDetailPage = z.infer<typeof resourceDetailResponseSchema>;

class ResourceDetailLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ResourceDetailLoadError';
	}
}

class ResourceNotFoundError extends Error {
	constructor() {
		super('resource not found');
		this.name = 'ResourceNotFoundError';
	}
}

// One resource's page: the image itself, what it was used as, and the
// generations it took part in (GET /api/resources/[key]), paged the same way
// the Resources gallery is.
class ResourceDetailState {
	image = $state.raw<MediaAccess | null>(null);
	roles = $state.raw<ResourceRole[]>([]);
	generations = $state.raw<ResourceGenerationRecord[]>([]);
	status = $state<ResourceDetailStatus>('idle');
	hasMore = $state(false);
	loadingMore = $state(false);
	#abort: AbortController | null = null;
	#nextOffset: number | null = null;
	#key: string | null = null;

	async load(key: string): Promise<void> {
		this.#abort?.abort();
		const controller = new AbortController();
		this.#abort = controller;
		this.#key = key;
		this.image = null;
		this.roles = [];
		this.generations = [];
		this.status = 'loading';
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;

		try {
			const page = await this.#fetchPage(key, 0, controller.signal);
			if (this.#abort !== controller) return;
			this.image = page.image;
			this.roles = page.roles;
			this.generations = page.generations;
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			if (error instanceof ResourceNotFoundError) {
				this.status = 'not-found';
				return;
			}
			this.status = 'error';
			console.error('Resource detail load failed:', error);
		} finally {
			if (this.#abort === controller) this.#abort = null;
		}
	}

	async loadMore(): Promise<void> {
		const key = this.#key;
		if (!key || !this.hasMore || this.loadingMore || this.#nextOffset === null) return;

		const controller = new AbortController();
		const offset = this.#nextOffset;
		this.#abort = controller;
		this.loadingMore = true;

		try {
			const page = await this.#fetchPage(key, offset, controller.signal);
			if (this.#abort !== controller) return;
			this.generations = [...this.generations, ...page.generations];
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.status = 'error';
			console.error('Resource detail load more failed:', error);
		} finally {
			// A request that load()/clear() already superseded must not touch
			// loadingMore — they reset it themselves, and by the time this one
			// settles it may belong to a newer loadMore() still in flight.
			if (this.#abort === controller) {
				this.#abort = null;
				this.loadingMore = false;
			}
		}
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.#key = null;
		this.image = null;
		this.roles = [];
		this.generations = [];
		this.status = 'idle';
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;
	}

	async #fetchPage(key: string, offset: number, signal: AbortSignal): Promise<ResourceDetailPage> {
		const response = await fetch(
			`/api/resources/${encodeURIComponent(key)}?offset=${offset}&size=${PAGE_SIZE}`,
			{ signal }
		);
		if (response.status === 404) throw new ResourceNotFoundError();
		if (!response.ok) {
			throw new ResourceDetailLoadError(`resource request failed: HTTP ${response.status}`);
		}
		const parsed = resourceDetailResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new ResourceDetailLoadError('resource response invalid');
		return {
			...parsed.data,
			image: mediaAccess.normalize(parsed.data.image),
			generations: parsed.data.generations.map((generation) => ({
				...generation,
				image: mediaAccess.normalize(generation.image)
			}))
		};
	}

	#setNextPage(page: ResourceDetailPage): void {
		if (page.pagination.hasMore && page.generations.length === 0) {
			throw new ResourceDetailLoadError('resource pagination did not advance');
		}
		this.#nextOffset = page.pagination.hasMore
			? page.pagination.offset + page.generations.length
			: null;
		this.hasMore = this.#nextOffset !== null;
	}
}

export const resourceDetail = new ResourceDetailState();
