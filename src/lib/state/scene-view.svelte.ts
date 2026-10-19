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

import { tick } from 'svelte';

class SceneViewState {
	fullscreen = $state(false);
	comparing = $state(false);
	actionsHeight = $state(0);
	toolsPosition = $state<{ x: number; y: number } | null>(null);
	toolsWidth = $state<number | null>(null);
	position = $state<{ x: number; y: number } | null>(null);
	fullscreenPosition = $state<{ x: number; y: number } | null>(null);
	#trigger: HTMLElement | null = null;

	enter(trigger: HTMLElement): void {
		this.#trigger = trigger;
		this.fullscreen = true;
	}

	exit(): void {
		this.fullscreen = false;
		const trigger = this.#trigger;
		this.#trigger = null;
		if (trigger)
			void tick().then(() => {
				if (trigger.isConnected) trigger.focus();
			});
	}
}

export const sceneView = new SceneViewState();
