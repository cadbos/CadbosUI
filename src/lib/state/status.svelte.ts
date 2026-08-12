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
const MAX_TIMER_INTERVAL_SECONDS = Math.floor(2_147_483_647 / 1_000);

class StatusLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StatusLoadError';
	}
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

	return seconds * 1_000;
}

class StatusState {
	snapshot = $state.raw<HealthSnapshot | null>(null);
	state = $state<StatusLoadState>('idle');
	error = $state<string | null>(null);
	#active = false;
	#abort: AbortController | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;

	start(): void {
		this.stop();
		this.#active = true;
		this.state = 'loading';
		void this.#refresh();
	}

	stop(): void {
		this.#active = false;
		this.#abort?.abort();
		this.#abort = null;
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		this.snapshot = null;
		this.state = 'idle';
		this.error = null;
	}

	async #refresh(): Promise<void> {
		const controller = new AbortController();
		this.#abort = controller;
		let nextPoll = DEFAULT_POLL_INTERVAL_MS;

		try {
			const response = await fetch('/healthz', { signal: controller.signal });
			if (response.status !== 200 && response.status !== 503) {
				throw new StatusLoadError('health request failed');
			}

			const parsed = healthSnapshotSchema.safeParse(await response.json());
			if (!parsed.success) throw new StatusLoadError('health response invalid');
			if (!this.#active || this.#abort !== controller) return;

			this.snapshot = parsed.data;
			this.state = 'ready';
			this.error = null;
			nextPoll = pollInterval(response);
		} catch (error) {
			if (controller.signal.aborted) return;
			this.state = this.snapshot === null ? 'error' : 'ready';
			this.error = error instanceof Error ? error.name : 'StatusLoadError';
			console.error(
				'Health status load failed:',
				error instanceof Error ? error.name : typeof error
			);
		} finally {
			if (this.#abort === controller) this.#abort = null;
		}

		if (!this.#active) return;
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.#refresh();
		}, nextPoll);
	}
}

export const status = new StatusState();
