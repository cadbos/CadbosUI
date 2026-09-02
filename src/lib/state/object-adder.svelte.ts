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

import type { ObjectAdderRect } from '$lib/api/contract';

export interface ObjectAdderImage {
	url: string;
	hash?: string;
}

// Small standalone store (not part of RequestState) for the "add object via
// reference photo" canvas — shared between ObjectAdderCanvas.svelte (mounted
// in Workspace.svelte's main canvas, like MaskEditor) and ObjectAdderPanel.svelte
// (mounted in EditPanel.svelte's side panel), which are siblings, not
// parent/child. The placed object's file and on-canvas rect are spatial UI
// state, not request-model content — same reasoning as MaskEditor's brush
// strokes never touching RequestState either; only the final job/prompt do
// (see RequestState.objectAdderPrompt/toObjectAdderRequest).
class ObjectAdderState {
	// Whether the "add-object" tool tab is showing this canvas instead of the
	// preset grid — read by both EditPanel.svelte (which panel to render) and
	// Workspace.svelte (whether to swap the main canvas), so it can't live as
	// local state in either alone.
	referenceMode = $state(false);
	objectImage = $state<ObjectAdderImage | undefined>(undefined);
	rect = $state<ObjectAdderRect | null>(null);
	// Mirrors request.textureReplacementResultReady's role for the mask
	// editor: while a completed result exists for the current placement,
	// Workspace.svelte shows that result instead of this canvas (same photo
	// otherwise showing forever, even after generating) — see
	// showObjectAdderCanvas. Cleared whenever a new attempt starts (a fresh
	// submit, a newly picked object, or re-entering reference mode) so the
	// canvas comes back for the next placement.
	resultReady = $state(false);

	setReferenceMode(active: boolean): void {
		this.referenceMode = active;
		if (active) this.resultReady = false;
	}

	setObjectImage(image: ObjectAdderImage | undefined): void {
		this.objectImage = image;
		// A newly picked object needs a fresh default placement — its aspect
		// ratio (and any previous rect's meaning) no longer applies.
		this.rect = null;
		this.resultReady = false;
	}

	setRect(rect: ObjectAdderRect | null): void {
		this.rect = rect;
	}

	setResultReady(ready: boolean): void {
		this.resultReady = ready;
	}

	clear(): void {
		this.objectImage = undefined;
		this.rect = null;
		this.resultReady = false;
	}
}

export const objectAdder = new ObjectAdderState();
