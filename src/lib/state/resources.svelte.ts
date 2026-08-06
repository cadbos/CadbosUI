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
import type { ResourceImageRecord } from '$lib/api/contract';

export type ResourcesStatus = 'idle' | 'loading' | 'ready' | 'error';

const PAGE_SIZE = 30;

const resourceImageRecordSchema = z.object({
	sourceUrl: z.url(),
	createdAt: z.number().int().min(0)
});

const resourcesResponseSchema = z.object({
	images: z.array(resourceImageRecordSchema),
	pagination: z.object({
		offset: z.number().int().min(0),
		size: z.number().int().min(1),
		hasMore: z.boolean()
	})
});

class ResourcesLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ResourcesLoadError';
	}
}

class ResourcesState {
	images = $state.raw<ResourceImageRecord[]>([]);
	status = $state<ResourcesStatus>('idle');
	error = $state<string | null>(null);
	hasMore = $state(false);
	loadingMore = $state(false);
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
			this.images = page.images;
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.images = [];
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'ResourcesLoadError';
			this.hasMore = false;
			this.#nextOffset = null;
			console.error('Resources load failed:', error);
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
			this.images = [...this.images, ...page.images];
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'ResourcesLoadError';
			console.error('Resources load more failed:', error);
		} finally {
			if (this.#abort === controller) this.#abort = null;
			this.loadingMore = false;
		}
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.images = [];
		this.status = 'idle';
		this.error = null;
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;
	}

	async #fetchPage(
		offset: number,
		signal: AbortSignal
	): Promise<z.infer<typeof resourcesResponseSchema>> {
		const response = await fetch(`/api/resources?offset=${offset}&size=${PAGE_SIZE}`, { signal });
		if (!response.ok) throw new ResourcesLoadError('resources request failed');

		const parsed = resourcesResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new ResourcesLoadError('resources response invalid');
		return parsed.data;
	}

	#setNextPage(page: z.infer<typeof resourcesResponseSchema>): void {
		if (page.pagination.hasMore && page.images.length === 0) {
			throw new ResourcesLoadError('resources pagination did not advance');
		}

		this.#nextOffset = page.pagination.hasMore ? page.pagination.offset + page.images.length : null;
		this.hasMore = this.#nextOffset !== null;
	}
}

export const resources = new ResourcesState();
