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
import type { TranslationKey } from '$lib/i18n/index.svelte';

// Opaque handle returned by start() and required by stop() — lets concurrent
// flows (e.g. a render kicked off while an object-replacement job is still
// polling) each remove only their own entry, so the label shown always
// reflects the most recently started flow that's still actually active,
// never a stale one left behind by an unrelated flow finishing first.
export type GenerationOverlayFlow = number;

interface OverlayFlow {
	id: GenerationOverlayFlow;
	messageKey: TranslationKey;
	detailKey: TranslationKey | null;
}

class GenerationOverlayState {
	messageKey = $state<TranslationKey | null>(null);
	detailKey = $state<TranslationKey | null>(null);
	#flows: OverlayFlow[] = $state.raw([]);
	#nextId = 0;

	get active(): boolean {
		return this.#flows.length > 0;
	}

	start(messageKey: TranslationKey, detailKey?: TranslationKey): GenerationOverlayFlow {
		const id = untrack(() => this.#nextId++);
		const flow: OverlayFlow = { id, messageKey, detailKey: detailKey ?? null };
		this.#flows = [...untrack(() => this.#flows), flow];
		this.messageKey = flow.messageKey;
		this.detailKey = flow.detailKey;
		return id;
	}

	stop(id: GenerationOverlayFlow): void {
		const flows = untrack(() => this.#flows).filter((flow) => flow.id !== id);
		this.#flows = flows;
		const top = flows.at(-1) ?? null;
		this.messageKey = top?.messageKey ?? null;
		this.detailKey = top?.detailKey ?? null;
	}
}

export const generationOverlay = new GenerationOverlayState();
