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
import type { UserUsageRecord } from '$lib/api/contract';

export type UsageStatus = 'idle' | 'loading' | 'ready' | 'error';

const PAGE_SIZE = 20;

const userUsageRecordSchema = z.object({
	pubkey: z.string().regex(/^[0-9a-f]{64}$/),
	balance: z.number(),
	totalDeposit: z.number(),
	lastDepositAt: z.number().int().min(0).nullable(),
	generationCount: z.number().int().min(0),
	totalSpend: z.number(),
	latestSpendAt: z.number().int().min(0).nullable()
});

const userUsageResponseSchema = z.object({
	users: z.array(userUsageRecordSchema),
	pagination: z.object({
		offset: z.number().int().min(0),
		size: z.number().int().min(1),
		hasMore: z.boolean()
	})
});

class UsageLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UsageLoadError';
	}
}

class UsageState {
	users = $state.raw<UserUsageRecord[]>([]);
	status = $state<UsageStatus>('idle');
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
			this.users = page.users;
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.users = [];
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'UsageLoadError';
			this.hasMore = false;
			this.#nextOffset = null;
			console.error('Usage load failed:', error);
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
			this.users = [...this.users, ...page.users];
			this.#setNextPage(page);
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.status = 'error';
			this.error = error instanceof Error ? error.name : 'UsageLoadError';
			console.error('Usage load more failed:', error);
		} finally {
			if (this.#abort === controller) this.#abort = null;
			this.loadingMore = false;
		}
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.users = [];
		this.status = 'idle';
		this.error = null;
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;
	}

	async #fetchPage(
		offset: number,
		signal: AbortSignal
	): Promise<z.infer<typeof userUsageResponseSchema>> {
		const response = await fetch(`/api/usage?offset=${offset}&size=${PAGE_SIZE}`, { signal });
		if (!response.ok) throw new UsageLoadError('usage request failed');

		const parsed = userUsageResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new UsageLoadError('usage response invalid');
		return parsed.data;
	}

	#setNextPage(page: z.infer<typeof userUsageResponseSchema>): void {
		if (page.pagination.hasMore && page.users.length === 0) {
			throw new UsageLoadError('usage pagination did not advance');
		}

		this.#nextOffset = page.pagination.hasMore ? page.pagination.offset + page.users.length : null;
		this.hasMore = this.#nextOffset !== null;
	}
}

export const usage = new UsageState();
