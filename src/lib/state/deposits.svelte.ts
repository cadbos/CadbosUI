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
import type { DepositResponse, PackageRecord } from '$lib/api/contract';
import { auth } from '$lib/state/auth.svelte';

export type PackagesStatus = 'idle' | 'loading' | 'ready' | 'error';
export type DepositStatus = 'idle' | 'creating' | 'polling' | 'paid' | 'expired' | 'error';

// The client only ever needs to distinguish "dead invoice, start over" from
// "still pending" — 'failed' folds into the same UI state as 'expired'.
const POLL_INTERVAL_MS = 2000;

const packageRecordSchema = z.object({
	id: z.string().min(1),
	usdAmount: z.number(),
	creditsAwarded: z.number()
});

const packagesResponseSchema = z.object({
	packages: z.array(packageRecordSchema)
});

const depositResponseSchema = z.object({
	id: z.string().min(1),
	status: z.enum(['pending', 'paid', 'expired', 'failed']),
	bolt11: z.string().min(1),
	satsAmount: z.number(),
	usdAmount: z.number(),
	expiresAt: z.number(),
	balance: z.number().optional()
});

class DepositLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DepositLoadError';
	}
}

class DepositsState {
	packages = $state.raw<PackageRecord[]>([]);
	packagesStatus = $state<PackagesStatus>('idle');
	packagesError = $state<string | null>(null);

	activeDeposit = $state.raw<DepositResponse | null>(null);
	depositStatus = $state<DepositStatus>('idle');
	depositError = $state<string | null>(null);

	#pollTimer: ReturnType<typeof setTimeout> | null = null;
	#creditRefreshed = false;

	async loadPackages(): Promise<void> {
		this.packagesStatus = 'loading';
		this.packagesError = null;

		try {
			const response = await fetch('/api/packages');
			if (!response.ok) throw new DepositLoadError('packages request failed');

			const parsed = packagesResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new DepositLoadError('packages response invalid');

			this.packages = parsed.data.packages;
			this.packagesStatus = 'ready';
		} catch (error) {
			this.packages = [];
			this.packagesStatus = 'error';
			this.packagesError = error instanceof Error ? error.name : 'DepositLoadError';
			console.error('loadPackages failed:', error);
		}
	}

	async createDeposit(packageId: string): Promise<void> {
		this.#stopPolling();
		this.depositStatus = 'creating';
		this.depositError = null;
		this.activeDeposit = null;
		this.#creditRefreshed = false;

		try {
			const response = await fetch('/api/deposits', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ packageId })
			});

			if (!response.ok) {
				this.depositStatus = 'error';
				this.depositError = response.status === 429 ? 'rate_limited' : 'create_failed';
				return;
			}

			const parsed = depositResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new DepositLoadError('deposit response invalid');

			this.activeDeposit = parsed.data;
			this.depositStatus = 'polling';
			this.#schedulePoll();
		} catch (error) {
			this.depositStatus = 'error';
			this.depositError = 'create_failed';
			console.error('createDeposit failed:', error);
		}
	}

	reset(): void {
		this.#stopPolling();
		this.activeDeposit = null;
		this.depositStatus = 'idle';
		this.depositError = null;
		this.#creditRefreshed = false;
	}

	#schedulePoll(): void {
		this.#pollTimer = setTimeout(() => void this.#poll(), POLL_INTERVAL_MS);
	}

	#stopPolling(): void {
		if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
		this.#pollTimer = null;
	}

	async #poll(): Promise<void> {
		const deposit = this.activeDeposit;
		if (!deposit) return;

		try {
			const response = await fetch(`/api/deposits/${deposit.id}`);
			if (!response.ok) throw new DepositLoadError('deposit status request failed');

			const parsed = depositResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new DepositLoadError('deposit status response invalid');

			// A reset() (or a newer deposit) may have run while this request was in
			// flight — a stale response must not resurrect polling or state.
			if (this.activeDeposit?.id !== deposit.id) return;

			this.activeDeposit = parsed.data;

			if (parsed.data.status === 'pending') {
				this.#schedulePoll();
				return;
			}

			if (parsed.data.status === 'paid') {
				this.depositStatus = 'paid';
				if (!this.#creditRefreshed) {
					this.#creditRefreshed = true;
					void auth.refreshCredit();
				}
				return;
			}

			this.depositStatus = 'expired';
		} catch (error) {
			// A single failed poll (network blip) must not surface as an error or
			// stop polling — mirrors how the [id] server route itself tolerates a
			// failed wallet lookup and just leaves the deposit pending.
			console.error('deposit poll failed:', error);
			if (this.activeDeposit?.id === deposit.id) this.#schedulePoll();
		}
	}
}

export const deposits = new DepositsState();
