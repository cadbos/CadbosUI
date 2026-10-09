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

export const REVEAL_ON_TIMEOUT_MS = 8_000;

export function revealOnTimeout(
	reveal: () => void,
	delayMs: number = REVEAL_ON_TIMEOUT_MS
): () => void {
	const timer = setTimeout(reveal, delayMs);
	return () => clearTimeout(timer);
}

export interface RevealTimers {
	arm(id: string, reveal: () => void): void;
	retain(ids: Iterable<string>, reveal: (id: string) => void): void;
	disarm(id: string): void;
	clear(): void;
}

export function createRevealTimers(delayMs: number = REVEAL_ON_TIMEOUT_MS): RevealTimers {
	const timers = new Map<string, () => void>();
	return {
		arm(id, reveal) {
			if (timers.has(id)) return;
			timers.set(
				id,
				revealOnTimeout(() => {
					timers.delete(id);
					reveal();
				}, delayMs)
			);
		},
		retain(ids, reveal) {
			const live = new Set(ids);
			for (const id of live) this.arm(id, () => reveal(id));
			for (const id of [...timers.keys()]) {
				if (!live.has(id)) this.disarm(id);
			}
		},
		disarm(id) {
			const stop = timers.get(id);
			if (!stop) return;
			stop();
			timers.delete(id);
		},
		clear() {
			for (const stop of timers.values()) stop();
			timers.clear();
		}
	};
}
