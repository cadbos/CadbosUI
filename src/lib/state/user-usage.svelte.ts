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
	type GenerationKindCount,
	type UsageGenerationRecord,
	type UserUsageRecord
} from '$lib/api/contract';
import { UsageLoadError, userUsageRecordSchema } from '$lib/state/usage.svelte';

export type UserUsageStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';
export type UserGenerationsStatus = 'idle' | 'loading' | 'ready' | 'error';

// One local calendar day as [from, to) epoch-millisecond bounds.
export interface UsageDay {
	from: number;
	to: number;
}

const PAGE_SIZE = 20;

const userUsageDetailResponseSchema = z.object({
	user: userUsageRecordSchema,
	generationKinds: z.array(
		z.object({ kind: z.enum(generationKinds), count: z.number().int().min(0) })
	)
});

const usageGenerationsResponseSchema = z.object({
	generations: z.array(
		z.object({
			id: z.string().min(1),
			kind: z.enum(generationKinds),
			createdAt: z.number().int().min(0),
			prompt: z.string(),
			source: mediaAccessSchema,
			result: mediaAccessSchema,
			reference: mediaAccessSchema.nullable()
		})
	),
	pagination: z.object({
		offset: z.number().int().min(0),
		size: z.number().int().min(1),
		hasMore: z.boolean()
	})
});

function rangeSearch(range: UsageDay): URLSearchParams {
	return new URLSearchParams({ from: String(range.from), to: String(range.to) });
}

class UserUsageState {
	record = $state.raw<UserUsageRecord | null>(null);
	generationKinds = $state.raw<GenerationKindCount[]>([]);
	status = $state<UserUsageStatus>('idle');
	generations = $state.raw<UsageGenerationRecord[]>([]);
	generationsStatus = $state<UserGenerationsStatus>('idle');
	hasMoreGenerations = $state(false);
	loadingMoreGenerations = $state(false);
	#abort: AbortController | null = null;
	#pubkey: string | null = null;
	#range: UsageDay | null = null;
	#nextOffset: number | null = null;

	load(pubkey: string, range: UsageDay | null): void {
		this.clear();
		const controller = new AbortController();
		this.#abort = controller;
		this.#pubkey = pubkey;
		this.#range = range;
		this.status = 'loading';

		void this.#loadDetail(pubkey, range, controller.signal);
		if (range !== null) {
			this.generationsStatus = 'loading';
			void this.#loadGenerations(pubkey, range, 0, controller.signal);
		}
	}

	async loadMoreGenerations(): Promise<void> {
		const controller = this.#abort;
		if (
			controller === null ||
			this.#pubkey === null ||
			this.#range === null ||
			this.#nextOffset === null ||
			this.loadingMoreGenerations
		) {
			return;
		}
		this.loadingMoreGenerations = true;
		await this.#loadGenerations(this.#pubkey, this.#range, this.#nextOffset, controller.signal);
		if (!controller.signal.aborted) this.loadingMoreGenerations = false;
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.#pubkey = null;
		this.#range = null;
		this.#nextOffset = null;
		this.record = null;
		this.generationKinds = [];
		this.status = 'idle';
		this.generations = [];
		this.generationsStatus = 'idle';
		this.hasMoreGenerations = false;
		this.loadingMoreGenerations = false;
	}

	async #loadDetail(pubkey: string, range: UsageDay | null, signal: AbortSignal): Promise<void> {
		try {
			const search = range === null ? '' : `?${rangeSearch(range)}`;
			const response = await fetch(`/api/usage/users/${pubkey}${search}`, { signal });
			if (!response.ok) throw new UsageLoadError('user usage request failed', response.status);

			const parsed = userUsageDetailResponseSchema.safeParse(
				await response.json().catch(() => null)
			);
			if (!parsed.success) throw new UsageLoadError('user usage response invalid');

			if (signal.aborted) return;
			this.record = parsed.data.user;
			this.generationKinds = parsed.data.generationKinds;
			this.status = 'ready';
		} catch (error) {
			if (signal.aborted) return;
			this.status = error instanceof UsageLoadError && error.status === 404 ? 'not-found' : 'error';
			console.error('User usage load failed:', error);
		}
	}

	async #loadGenerations(
		pubkey: string,
		range: UsageDay,
		offset: number,
		signal: AbortSignal
	): Promise<void> {
		try {
			const search = rangeSearch(range);
			search.set('offset', String(offset));
			search.set('size', String(PAGE_SIZE));
			const response = await fetch(`/api/usage/users/${pubkey}/generations?${search}`, {
				signal
			});
			if (!response.ok) {
				throw new UsageLoadError('user generations request failed', response.status);
			}

			const parsed = usageGenerationsResponseSchema.safeParse(
				await response.json().catch(() => null)
			);
			if (!parsed.success) throw new UsageLoadError('user generations response invalid');
			const page = parsed.data;
			if (page.pagination.hasMore && page.generations.length === 0) {
				throw new UsageLoadError('user generations pagination did not advance');
			}

			if (signal.aborted) return;
			this.generations = [...this.generations, ...page.generations];
			this.#nextOffset = page.pagination.hasMore ? offset + page.generations.length : null;
			this.hasMoreGenerations = this.#nextOffset !== null;
			this.generationsStatus = 'ready';
		} catch (error) {
			if (signal.aborted) return;
			this.generationsStatus = 'error';
			this.hasMoreGenerations = false;
			this.#nextOffset = null;
			console.error('User generations load failed:', error);
		}
	}
}

export const userUsage = new UserUsageState();
