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

class GenerationOverlayState {
	messageKey = $state<TranslationKey | null>(null);
	detailKey = $state<TranslationKey | null>(null);
	#activeFlows = $state(0);

	get active(): boolean {
		return this.#activeFlows > 0;
	}

	start(messageKey: TranslationKey, detailKey?: TranslationKey): void {
		this.#activeFlows = untrack(() => this.#activeFlows) + 1;
		this.messageKey = messageKey;
		this.detailKey = detailKey ?? null;
	}

	stop(): void {
		const activeFlows = Math.max(0, untrack(() => this.#activeFlows) - 1);
		this.#activeFlows = activeFlows;
		if (activeFlows > 0) return;

		this.messageKey = null;
		this.detailKey = null;
	}
}

export const generationOverlay = new GenerationOverlayState();
