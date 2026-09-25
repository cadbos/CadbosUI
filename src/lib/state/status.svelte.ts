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

import { healthSnapshotSchema, type HealthSnapshot } from '$lib/api/contract';

export type StatusLoadState = 'idle' | 'loading' | 'ready' | 'error';

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TIMER_INTERVAL_SECONDS = Math.floor(2_147_483_647 / 1_000);

class StatusLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StatusLoadError';
	}
}

function ageSeconds(response: Response): number {
	const age = response.headers.get('age')?.trim();
	return age && /^\d+$/.test(age) ? Number(age) : 0;
}

function pollInterval(response: Response): number {
	const directive = response.headers
		.get('cache-control')
		?.split(',')
		.map((value) => value.trim())
		.find((value) => /^max-age\s*=/i.test(value));
	const match = directive?.match(/^max-age\s*=\s*"?(\d+)"?$/i);
	const seconds = match ? Number(match[1]) : Number.NaN;

	if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > MAX_TIMER_INTERVAL_SECONDS) {
		return DEFAULT_POLL_INTERVAL_MS;
	}

	return Math.max(MIN_POLL_INTERVAL_MS, (seconds - ageSeconds(response)) * 1_000);
}

class StatusState {
	snapshot = $state.raw<HealthSnapshot | null>(null);
	state = $state<StatusLoadState>('idle');
	error = $state<string | null>(null);
	#checked = false;
	#polling = false;
	#refreshPromise: Promise<void> | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#staleAt = 0;

	checkOnce(): void {
		if (this.#checked) return;
		this.#checked = true;
		if (this.snapshot === null) this.state = 'loading';
		void this.#refresh();
	}

	startPolling(): void {
		if (this.#polling) return;
		this.#polling = true;
		if (!this.#checked) {
			this.checkOnce();
			return;
		}
		if (this.#refreshPromise !== null) return;
		this.#schedulePoll();
	}

	stopPolling(): void {
		this.#polling = false;
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	#refresh(): Promise<void> {
		if (this.#refreshPromise !== null) return this.#refreshPromise;
		this.#refreshPromise = this.#performRefresh();
		return this.#refreshPromise;
	}

	async #performRefresh(): Promise<void> {
		let interval = DEFAULT_POLL_INTERVAL_MS;

		try {
			const response = await fetch('/healthz', {
				cache: 'no-store',
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			if (response.status !== 200 && response.status !== 503) {
				throw new StatusLoadError('health request failed');
			}

			const parsed = healthSnapshotSchema.safeParse(await response.json());
			if (!parsed.success) throw new StatusLoadError('health response invalid');

			this.snapshot = parsed.data;
			this.state = 'ready';
			this.error = null;
			interval = pollInterval(response);
		} catch (error) {
			this.state = this.snapshot === null ? 'error' : 'ready';
			this.error = error instanceof Error ? error.name : 'StatusLoadError';
			console.error(
				'Health status load failed:',
				error instanceof Error ? error.name : typeof error
			);
		} finally {
			this.#staleAt = Date.now() + interval;
			this.#refreshPromise = null;
		}

		this.#schedulePoll();
	}

	#schedulePoll(): void {
		if (!this.#polling || this.#timer !== null) return;
		this.#timer = setTimeout(
			() => {
				this.#timer = null;
				void this.#refresh();
			},
			Math.max(0, this.#staleAt - Date.now())
		);
	}
}

export const status = new StatusState();
