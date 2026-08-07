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
	createDepositRequestSchema,
	depositResponseSchema,
	packagesResponseSchema,
	type CreateDepositRequest,
	type DepositResponse,
	type PackageRecord
} from '$lib/api/contract';
import { auth } from '$lib/state/auth.svelte';

export type PackagesStatus = 'idle' | 'loading' | 'ready' | 'error';
export type DepositError = 'create' | 'poll' | null;

const DEFAULT_POLL_DELAY_MS = 2_000;
const MAX_POLL_DELAY_MS = 30_000;
const POLL_REQUEST_TIMEOUT_MS = 15_000;
const STORAGE_PREFIX = 'cadbos.deposit.';

const persistedAttemptSchema = createDepositRequestSchema.extend({
	depositId: z.string().min(1).optional()
});

type PersistedAttempt = z.infer<typeof persistedAttemptSchema>;

class DepositClientError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DepositClientError';
	}
}

export class DepositsState {
	packages = $state.raw<PackageRecord[]>([]);
	packagesStatus = $state<PackagesStatus>('idle');
	selectedPackageId = $state<string | null>(null);
	deposit = $state.raw<DepositResponse | null>(null);
	creating = $state(false);
	error = $state<DepositError>(null);
	pollWarning = $state(false);
	copiedBolt11 = $state<string | null>(null);
	copyFailed = $state(false);
	#active = false;
	#owner: string | null = null;
	#requestId: string | null = null;
	#run = 0;
	#packagesController: AbortController | null = null;
	#depositController: AbortController | null = null;

	activate(owner: string): void {
		this.#active = true;
		if (this.#owner !== owner) {
			this.#resetForOwner(owner);
			this.#restore();
		}

		const run = ++this.#run;
		if (this.packagesStatus !== 'ready') void this.#loadPackages(run);
		if (this.deposit?.status === 'creating' || this.deposit?.status === 'pending') {
			this.#startPolling(this.deposit.id, run);
		} else if (this.deposit === null && this.#requestId && this.selectedPackageId) {
			void this.createDeposit();
		}
	}

	deactivate(): void {
		this.#active = false;
		this.#run += 1;
		this.#packagesController?.abort();
		this.#depositController?.abort();
		this.#packagesController = null;
		this.#depositController = null;
		this.creating = false;
	}

	selectPackage(id: string): void {
		if (!this.packages.some((item) => item.id === id)) return;
		if (this.deposit?.status === 'creating' || this.deposit?.status === 'pending') return;
		if (this.selectedPackageId !== id && this.deposit === null) {
			this.#requestId = null;
			this.#removePersisted();
		}
		this.selectedPackageId = id;
		this.error = null;
	}

	async retryPackages(): Promise<void> {
		await this.#loadPackages(this.#run);
	}

	async createDeposit(): Promise<void> {
		const owner = this.#owner;
		const packageId = this.selectedPackageId;
		if (!this.#active || !owner || !packageId || this.creating) return;

		const run = this.#run;
		const requestId = this.#requestId ?? crypto.randomUUID();
		this.#requestId = requestId;
		this.#persist({ requestId, packageId });
		this.#depositController?.abort();
		const controller = new AbortController();
		this.#depositController = controller;
		this.creating = true;
		this.error = null;
		this.pollWarning = false;

		const body: CreateDepositRequest = { requestId, packageId };
		try {
			const response = await fetch('/api/deposits', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: controller.signal
			});
			if (!response.ok) throw new DepositClientError('deposit creation request failed');
			const result = await this.#parseDeposit(response);
			if (!this.#isCurrent(controller, run)) return;
			this.#applyDeposit(result, packageId);
			if (result.status === 'creating' || result.status === 'pending') {
				this.#startPolling(result.id, run);
			}
		} catch (error) {
			if (controller.signal.aborted || !this.#isRunCurrent(run)) return;
			this.error = 'create';
			console.error('Deposit creation failed:', error);
		} finally {
			if (this.#depositController === controller) this.#depositController = null;
			if (this.#isRunCurrent(run)) this.creating = false;
		}
	}

	retryAttempt(): void {
		if (!this.selectedPackageId) return;
		this.#requestId = null;
		this.deposit = null;
		this.error = null;
		this.pollWarning = false;
		this.copiedBolt11 = null;
		this.copyFailed = false;
		void this.createDeposit();
	}

	startAnother(): void {
		this.#depositController?.abort();
		this.#requestId = null;
		this.deposit = null;
		this.selectedPackageId = null;
		this.error = null;
		this.pollWarning = false;
		this.copiedBolt11 = null;
		this.copyFailed = false;
		this.#removePersisted();
	}

	resumePolling(): void {
		if (!this.deposit || !this.#active) return;
		this.error = null;
		this.pollWarning = false;
		this.#startPolling(this.deposit.id, this.#run);
	}

	async copyInvoice(): Promise<void> {
		const bolt11 = this.deposit?.bolt11;
		if (!bolt11) return;
		this.copyFailed = false;
		try {
			await navigator.clipboard.writeText(bolt11);
			if (this.deposit?.bolt11 === bolt11) this.copiedBolt11 = bolt11;
		} catch (error) {
			this.copyFailed = true;
			console.error('Invoice copy failed:', error);
		}
	}

	async #loadPackages(run: number): Promise<void> {
		this.#packagesController?.abort();
		const controller = new AbortController();
		this.#packagesController = controller;
		this.packagesStatus = 'loading';
		try {
			const response = await fetch('/api/packages', { signal: controller.signal });
			if (!response.ok) throw new DepositClientError('packages request failed');
			const parsed = packagesResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new DepositClientError('packages response invalid');
			if (this.#packagesController !== controller || !this.#isRunCurrent(run)) return;
			this.packages = parsed.data.packages;
			this.packagesStatus = 'ready';
		} catch (error) {
			if (controller.signal.aborted || !this.#isRunCurrent(run)) return;
			this.packagesStatus = 'error';
			console.error('Packages load failed:', error);
		} finally {
			if (this.#packagesController === controller) this.#packagesController = null;
		}
	}

	#startPolling(id: string, run: number): void {
		this.#depositController?.abort();
		const controller = new AbortController();
		this.#depositController = controller;
		void this.#poll(id, controller, run);
	}

	async #poll(id: string, controller: AbortController, run: number): Promise<void> {
		let failures = 0;
		while (this.#isCurrent(controller, run)) {
			const requestSignal = AbortSignal.any([
				controller.signal,
				AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS)
			]);
			try {
				const response = await fetch(`/api/deposits/${encodeURIComponent(id)}`, {
					signal: requestSignal
				});
				if (!this.#isCurrent(controller, run)) return;
				if (!response.ok) {
					if (response.status >= 500 || response.status === 429) {
						throw new DepositClientError('deposit status temporarily unavailable');
					}
					this.error = 'poll';
					console.error('Deposit status request failed:', response.status);
					return;
				}

				const result = await this.#parseDeposit(response, id);
				if (!this.#isCurrent(controller, run)) return;
				failures = 0;
				this.pollWarning = false;
				this.error = null;
				this.#applyDeposit(result, this.selectedPackageId);
				if (result.status !== 'creating' && result.status !== 'pending') return;
				await this.#wait(this.#pollDelay(response), controller.signal);
			} catch (error) {
				if (!this.#isCurrent(controller, run)) return;
				failures += 1;
				this.pollWarning = true;
				console.error('Deposit status check failed:', error);
				await this.#wait(
					Math.min(DEFAULT_POLL_DELAY_MS * 2 ** (failures - 1), MAX_POLL_DELAY_MS),
					controller.signal
				);
			}
		}
	}

	async #parseDeposit(response: Response, expectedId?: string): Promise<DepositResponse> {
		const parsed = depositResponseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success || (expectedId !== undefined && parsed.data.id !== expectedId)) {
			throw new DepositClientError('deposit response invalid');
		}
		return parsed.data;
	}

	#applyDeposit(result: DepositResponse, packageId: string | null): void {
		if (this.deposit?.status === 'paid' && result.status !== 'paid') return;
		const becamePaid = result.status === 'paid' && this.deposit?.status !== 'paid';
		const invoiceChanged = result.bolt11 !== this.deposit?.bolt11;
		this.deposit = result;
		if (invoiceChanged) {
			this.copiedBolt11 = null;
			this.copyFailed = false;
		}
		if (this.#requestId && packageId) {
			this.#persist({ requestId: this.#requestId, packageId, depositId: result.id });
		}
		if (becamePaid) void auth.refreshCredit();
	}

	#resetForOwner(owner: string): void {
		this.#packagesController?.abort();
		this.#depositController?.abort();
		this.#owner = owner;
		this.#requestId = null;
		this.selectedPackageId = null;
		this.deposit = null;
		this.creating = false;
		this.error = null;
		this.pollWarning = false;
		this.copiedBolt11 = null;
		this.copyFailed = false;
	}

	#restore(): void {
		if (!this.#owner) return;
		let value: string | null;
		try {
			value = localStorage.getItem(`${STORAGE_PREFIX}${this.#owner}`);
		} catch (error) {
			console.error('Deposit state restore failed:', error);
			return;
		}
		if (!value) return;
		const parsed = persistedAttemptSchema.safeParse(this.#parsePersisted(value));
		if (!parsed.success) {
			console.error('Stored deposit state is invalid');
			this.#removePersisted();
			return;
		}
		this.#requestId = parsed.data.requestId;
		this.selectedPackageId = parsed.data.packageId;
		if (parsed.data.depositId) {
			this.deposit = { id: parsed.data.depositId, status: 'creating' };
		}
	}

	#parsePersisted(value: string): unknown {
		try {
			return JSON.parse(value);
		} catch (error) {
			console.error('Deposit state parse failed:', error);
			return null;
		}
	}

	#persist(attempt: PersistedAttempt): void {
		if (!this.#owner) return;
		try {
			localStorage.setItem(`${STORAGE_PREFIX}${this.#owner}`, JSON.stringify(attempt));
		} catch (error) {
			console.error('Deposit state persistence failed:', error);
		}
	}

	#removePersisted(): void {
		if (!this.#owner) return;
		try {
			localStorage.removeItem(`${STORAGE_PREFIX}${this.#owner}`);
		} catch (error) {
			console.error('Deposit state removal failed:', error);
		}
	}

	#pollDelay(response: Response): number {
		const value = response.headers.get('retry-after');
		if (!value) return DEFAULT_POLL_DELAY_MS;
		const seconds = Number(value);
		const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
		if (!Number.isFinite(delay)) return DEFAULT_POLL_DELAY_MS;
		return Math.min(Math.max(delay, 1_000), MAX_POLL_DELAY_MS);
	}

	#wait(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve) => {
			const timeout = setTimeout(done, ms);
			function done(): void {
				clearTimeout(timeout);
				signal.removeEventListener('abort', done);
				resolve();
			}
			signal.addEventListener('abort', done, { once: true });
		});
	}

	#isRunCurrent(run: number): boolean {
		return this.#active && this.#run === run;
	}

	#isCurrent(controller: AbortController, run: number): boolean {
		return (
			!controller.signal.aborted &&
			this.#depositController === controller &&
			this.#isRunCurrent(run)
		);
	}
}

export const deposits = new DepositsState();
