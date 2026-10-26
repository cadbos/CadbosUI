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

import { untrack } from 'svelte';
import type { GenerationKind, GenerationProvider, JobProgress } from '$lib/api/contract';
import type { TranslationKey } from '$lib/i18n/index.svelte';
import { generationEstimates } from '$lib/state/generation-estimates.svelte';

// Opaque handle returned by start() and required by stop() — lets concurrent
// flows (e.g. a render kicked off while an object-replacement job is still
// polling) each remove only their own entry, so the label shown always
// reflects the most recently started flow that's still actually active,
// never a stale one left behind by an unrelated flow finishing first.
export type GenerationOverlayFlow = number;

// Never shows 100% before the result is actually in.
const MAX_ESTIMATED_PERCENT = 99;
// How long a successful flow stays on screen at 100% before it goes; the
// result is already rendered underneath, so this delays nothing. Matches the
// overlay's closing fade (GenerationOverlay.svelte).
const FINISH_HOLD_MS = 650;

// What a polled job last reported, kept on the client clock: `origin` is the
// earliest moment the server's elapsed time places the job's start at.
export interface JobProgressState {
	jobId: string;
	origin: number;
	queueAhead: number | null;
}

export function trackJobProgress(
	previous: JobProgressState | null,
	jobId: string,
	progress: JobProgress,
	now: number
): JobProgressState {
	const origin = now - progress.elapsedMs;
	return {
		jobId,
		origin: previous?.jobId === jobId ? Math.min(previous.origin, origin) : origin,
		queueAhead: progress.queueAhead
	};
}

export interface GenerationProgress {
	percent: number;
	// Null once the run outlasts its estimate or has finished.
	remainingSec: number | null;
	queueAhead: number | null;
	done: boolean;
}

export interface GenerationOverlayOptions {
	detailKey?: TranslationKey;
	kind: GenerationKind;
	provider: GenerationProvider;
	// A polled job's latest report — it moves the start back to when the job
	// really began (e.g. after a reload) and carries its queue position.
	job?: () => JobProgressState | null;
}

interface OverlayFlow {
	id: GenerationOverlayFlow;
	messageKey: TranslationKey;
	options: GenerationOverlayOptions;
	startedAt: number;
	succeeded: boolean;
	closing: boolean;
}

class GenerationOverlayState {
	#flows: OverlayFlow[] = $state.raw([]);
	#nextId = 0;

	get active(): boolean {
		return this.#flows.length > 0;
	}

	get messageKey(): TranslationKey | null {
		return this.#flows.at(-1)?.messageKey ?? null;
	}

	get detailKey(): TranslationKey | null {
		return this.#flows.at(-1)?.options.detailKey ?? null;
	}

	get closing(): boolean {
		return this.#flows.at(-1)?.closing ?? false;
	}

	start(
		messageKey: TranslationKey,
		options: GenerationOverlayOptions,
		now = Date.now()
	): GenerationOverlayFlow {
		const id = untrack(() => this.#nextId++);
		const flow: OverlayFlow = {
			id,
			messageKey,
			options,
			startedAt: now,
			succeeded: false,
			closing: false
		};
		this.#flows = [...untrack(() => this.#flows), flow];
		return id;
	}

	// Called once the flow's result is in, before stop(): the flow then ends at
	// 100% instead of vanishing mid-estimate.
	markSucceeded(id: GenerationOverlayFlow): void {
		this.#update(id, { succeeded: true });
	}

	stop(id: GenerationOverlayFlow): void {
		const flow = untrack(() => this.#flows).find((candidate) => candidate.id === id);
		if (!flow || flow.closing) return;
		const showsProgress =
			generationEstimates.seconds(flow.options.kind, flow.options.provider) !== null;
		if (!flow.succeeded || !showsProgress) {
			this.#remove(id);
			return;
		}
		this.#update(id, { closing: true });
		setTimeout(() => this.#remove(id), FINISH_HOLD_MS);
	}

	#update(id: GenerationOverlayFlow, changes: Partial<OverlayFlow>): void {
		this.#flows = untrack(() => this.#flows).map((flow) =>
			flow.id === id ? { ...flow, ...changes } : flow
		);
	}

	#remove(id: GenerationOverlayFlow): void {
		this.#flows = untrack(() => this.#flows).filter((flow) => flow.id !== id);
	}

	// Null while no estimate exists for the flow on screen; the overlay then
	// keeps the flow's fixed hint instead.
	progress(now: number): GenerationProgress | null {
		const flow = this.#flows.at(-1);
		if (!flow) return null;
		const expectedSec = generationEstimates.seconds(flow.options.kind, flow.options.provider);
		if (expectedSec === null) return null;
		if (flow.succeeded) return { percent: 100, remainingSec: null, queueAhead: null, done: true };
		const job = flow.options.job?.() ?? null;
		const origin = Math.min(flow.startedAt, job?.origin ?? flow.startedAt);
		const elapsedSec = Math.max(0, now - origin) / 1000;
		return {
			percent: Math.min(MAX_ESTIMATED_PERCENT, Math.floor((elapsedSec / expectedSec) * 100)),
			remainingSec: elapsedSec < expectedSec ? Math.ceil(expectedSec - elapsedSec) : null,
			queueAhead: job?.queueAhead ?? null,
			done: false
		};
	}
}

export const generationOverlay = new GenerationOverlayState();
