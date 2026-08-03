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

import { browser } from '$app/environment';
import { logBoundaryError } from '$lib/utils';

// Matches the former `.panel-col`/`.mode-nav` flex-basis so the floating
// panel keeps the width users are already used to. Kept in sync by hand with
// the `--tools-panel-width` custom property in app.css (this module has no
// DOM access to read that value back at import time).
export const TOOLS_PANEL_WIDTH = 360;

const VIEWPORT_MARGIN = 16;
const STORAGE_KEY = 'cadbos.toolsPanel.v1';

export interface ToolsPanelPosition {
	x: number;
	y: number;
}

interface StoredToolsPanel {
	open: boolean;
	position: ToolsPanelPosition | null;
}

// Keeps the panel's top-left corner fully inside the viewport (minus a fixed
// margin) no matter what drag delta or window resize produced the candidate
// position. Pure so drag handling and the resize listener can both reuse it
// without re-deriving the same bounds math, and so it's unit-testable without
// a DOM.
export function clampToolsPanelPosition(
	x: number,
	y: number,
	panelWidth: number,
	panelHeight: number,
	viewportWidth: number,
	viewportHeight: number,
	margin: number = VIEWPORT_MARGIN
): ToolsPanelPosition {
	const maxX = Math.max(margin, viewportWidth - panelWidth - margin);
	const maxY = Math.max(margin, viewportHeight - panelHeight - margin);
	return {
		x: Math.min(Math.max(x, margin), maxX),
		y: Math.min(Math.max(y, margin), maxY)
	};
}

function isToolsPanelPosition(value: unknown): value is ToolsPanelPosition {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as ToolsPanelPosition).x === 'number' &&
		typeof (value as ToolsPanelPosition).y === 'number'
	);
}

function isStoredToolsPanel(value: unknown): value is StoredToolsPanel {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Partial<StoredToolsPanel>;
	if (typeof candidate.open !== 'boolean') return false;
	return candidate.position === null || isToolsPanelPosition(candidate.position);
}

function readStoredState(): StoredToolsPanel | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return isStoredToolsPanel(parsed) ? parsed : null;
	} catch (error) {
		logBoundaryError('toolsPanel.restore', error);
		return null;
	}
}

class ToolsPanelState {
	open = $state(true);
	// null = not yet dragged, panel sits at its CSS-anchored default corner.
	position = $state.raw<ToolsPanelPosition | null>(null);
	#hydrated = false;

	// Deliberately not read in the constructor: this store is a client+server
	// module-level singleton, so restoring localStorage there would make the
	// very first client render (the one hydration diffs against the
	// server-rendered HTML) already reflect a dragged/closed state the server
	// never rendered. Called once from FloatingToolsPanel's mount effect
	// instead, so it only ever runs after hydration has settled.
	hydrate(): void {
		if (this.#hydrated) return;
		this.#hydrated = true;
		const stored = readStoredState();
		if (stored) {
			this.open = stored.open;
			this.position = stored.position;
		}
	}

	setOpen(open: boolean): void {
		this.open = open;
		this.#persist();
	}

	setPosition(x: number, y: number): void {
		this.position = { x, y };
		this.#persist();
	}

	// Updates the position without writing to localStorage — for high-frequency
	// callers like pointermove, where persisting on every event would hammer
	// storage for no benefit until the drag actually ends.
	updatePosition(x: number, y: number): void {
		this.position = { x, y };
	}

	persist(): void {
		this.#persist();
	}

	#persist(): void {
		if (!browser) return;
		try {
			const payload: StoredToolsPanel = { open: this.open, position: this.position };
			localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
		} catch (error) {
			logBoundaryError('toolsPanel.persist', error);
		}
	}
}

export const toolsPanel = new ToolsPanelState();
