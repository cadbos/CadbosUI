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
import type { GeneratedImageRecord } from '$lib/api/contract';

export type GeneratedImagesStatus = 'idle' | 'loading' | 'ready' | 'error';

const PAGE_SIZE = 100;

const generatedImageRecordSchema = z.object({
	id: z.string().min(1),
	url: z.url(),
	createdAt: z.number().int().min(0)
});

const generatedImagesResponseSchema = z.object({
	images: z.array(generatedImageRecordSchema),
	pagination: z.object({
		offset: z.number().int().min(0),
		size: z.number().int().min(1),
		hasMore: z.boolean()
	})
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

function sortLatestFirst(images: GeneratedImageRecord[]): GeneratedImageRecord[] {
	return [...images].sort((left, right) => {
		const createdAtOrder = right.createdAt - left.createdAt;
		return createdAtOrder === 0 ? right.id.localeCompare(left.id) : createdAtOrder;
	});
}

class GeneratedImagesState {
	images = $state.raw<GeneratedImageRecord[]>([]);
	status = $state<GeneratedImagesStatus>('idle');
	error = $state<string | null>(null);
	deleteFailed = $state(false);
	hasMore = $state(false);
	loadingMore = $state(false);
	deletingIds = new SvelteSet<string>();
	#abort: AbortController | null = null;
	#nextOffset: number | null = null;

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
		this.images = [];
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
		const response = await fetch(`/api/generated-images?offset=${offset}&size=${PAGE_SIZE}`, {
			signal
		});
		if (!response.ok) throw new GeneratedImagesLoadError('generated images request failed');

		const parsed = generatedImagesResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new GeneratedImagesLoadError('generated images response invalid');
		return parsed.data;
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
