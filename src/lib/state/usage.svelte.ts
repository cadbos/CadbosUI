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
import type { UsageProfile, UserUsageRecord } from '$lib/api/contract';

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

const usageProfileSchema = z.object({
	name: z.string().optional(),
	picture: z.url({ protocol: /^https?$/ }).optional()
});

const usageProfilesResponseSchema = z.object({
	profiles: z.record(z.string().regex(/^[0-9a-f]{64}$/), usageProfileSchema)
});

const walletBalanceResponseSchema = z.object({
	balance: z.number()
});

export type WalletBalanceStatus = 'idle' | 'loading' | 'ready' | 'error';

class UsageLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UsageLoadError';
	}
}

class UsageState {
	users = $state.raw<UserUsageRecord[]>([]);
	profiles = $state.raw<Record<string, UsageProfile>>({});
	status = $state<UsageStatus>('idle');
	error = $state<string | null>(null);
	hasMore = $state(false);
	loadingMore = $state(false);
	walletBalance = $state<number | null>(null);
	walletBalanceStatus = $state<WalletBalanceStatus>('idle');
	#abort: AbortController | null = null;
	#profileAborts = new Set<AbortController>();
	#walletBalanceAbort: AbortController | null = null;
	#nextOffset: number | null = null;

	async load(): Promise<void> {
		this.#abort?.abort();
		this.#abortProfiles();
		this.#walletBalanceAbort?.abort();
		const controller = new AbortController();
		this.#abort = controller;
		this.status = 'loading';
		this.error = null;
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;
		this.profiles = {};
		this.walletBalance = null;
		this.walletBalanceStatus = 'idle';

		void this.#loadWalletBalance();

		try {
			const page = await this.#fetchPage(0, controller.signal);
			if (this.#abort !== controller) return;
			this.users = page.users;
			this.#setNextPage(page);
			this.status = 'ready';
			void this.#loadProfiles(page.users);
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
			void this.#loadProfiles(page.users);
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
		this.#abortProfiles();
		this.#walletBalanceAbort?.abort();
		this.#abort = null;
		this.#walletBalanceAbort = null;
		this.users = [];
		this.profiles = {};
		this.status = 'idle';
		this.error = null;
		this.hasMore = false;
		this.loadingMore = false;
		this.#nextOffset = null;
		this.walletBalance = null;
		this.walletBalanceStatus = 'idle';
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

	async #loadProfiles(users: UserUsageRecord[]): Promise<void> {
		if (users.length === 0) return;

		const controller = new AbortController();
		this.#profileAborts.add(controller);
		try {
			const profiles = await this.#fetchProfiles(
				users.map((user) => user.pubkey),
				controller.signal
			);
			if (!controller.signal.aborted) this.profiles = { ...this.profiles, ...profiles };
		} catch (error) {
			if (!controller.signal.aborted) console.error('Usage profile load failed:', error);
		} finally {
			this.#profileAborts.delete(controller);
		}
	}

	async #fetchProfiles(
		pubkeys: string[],
		signal: AbortSignal
	): Promise<Record<string, UsageProfile>> {
		const response = await fetch('/api/usage/profiles', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pubkeys }),
			signal
		});
		if (!response.ok) throw new UsageLoadError('usage profile request failed');

		const parsed = usageProfilesResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new UsageLoadError('usage profile response invalid');
		return parsed.data.profiles;
	}

	async #loadWalletBalance(): Promise<void> {
		const controller = new AbortController();
		this.#walletBalanceAbort = controller;
		this.walletBalanceStatus = 'loading';

		try {
			const response = await fetch('/api/usage/balance', { signal: controller.signal });
			if (!response.ok) throw new UsageLoadError('wallet balance request failed');

			const parsed = walletBalanceResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new UsageLoadError('wallet balance response invalid');

			if (this.#walletBalanceAbort !== controller) return;
			this.walletBalance = parsed.data.balance;
			this.walletBalanceStatus = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.walletBalance = null;
			this.walletBalanceStatus = 'error';
			console.error('Wallet balance load failed:', error);
		} finally {
			if (this.#walletBalanceAbort === controller) this.#walletBalanceAbort = null;
		}
	}

	#setNextPage(page: z.infer<typeof userUsageResponseSchema>): void {
		if (page.pagination.hasMore && page.users.length === 0) {
			throw new UsageLoadError('usage pagination did not advance');
		}

		this.#nextOffset = page.pagination.hasMore ? page.pagination.offset + page.users.length : null;
		this.hasMore = this.#nextOffset !== null;
	}

	#abortProfiles(): void {
		for (const controller of this.#profileAborts) controller.abort();
		this.#profileAborts.clear();
	}
}

export const usage = new UsageState();
