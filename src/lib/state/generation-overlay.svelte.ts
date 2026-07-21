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

import type { TranslationKey } from '$lib/i18n/index.svelte';

// Single source of truth for the full-screen "generation in progress" overlay
// (GenerationOverlay.svelte, mounted once in +layout.svelte). Every submit flow
// (create, edit, style transfer, object replacement, upscale) calls start()/stop()
// around its own request instead of rendering its own loading UI.
class GenerationOverlayState {
	messageKey = $state<TranslationKey | null>(null);
	detailKey = $state<TranslationKey | null>(null);

	get active(): boolean {
		return this.messageKey !== null;
	}

	start(messageKey: TranslationKey, detailKey?: TranslationKey): void {
		this.messageKey = messageKey;
		this.detailKey = detailKey ?? null;
	}

	stop(): void {
		this.messageKey = null;
		this.detailKey = null;
	}
}

export const generationOverlay = new GenerationOverlayState();
