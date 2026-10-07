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

import { createContext } from 'svelte';
import { browser } from '$app/environment';
import { logBoundaryError } from '$lib/utils';

// Matches the former `.panel-col`/`.mode-nav` flex-basis so the floating
// panel keeps the width users are already used to. Kept in sync by hand with
// the `--tools-panel-width` custom property in app.css (this module has no
// DOM access to read that value back at import time).
export const TOOLS_PANEL_WIDTH = 360;
export const MIN_TOOLS_PANEL_WIDTH = 280;
export const TOOLS_PANEL_SIZE_PRESET_FRACTIONS = [0.25, 0.5, 0.75] as const;
const SIZE_PRESET_TOLERANCE = 8;

const VIEWPORT_MARGIN = 16;
const STORAGE_KEY = 'cadbos.toolsPanel.v1';

export interface ToolsPanelPosition {
	x: number;
	y: number;
}

interface StoredToolsPanel {
	open: boolean;
	position: ToolsPanelPosition | null;
	width: number | null;
}

// The sticky app header (+layout.svelte) sits above the floating panel's
// z-index, so a panel dragged under it would be unreachable. The layout
// provides the header's current viewport-relative bottom edge through this
// context; the panel treats it as its top boundary.
export const [getToolsPanelTopBoundary, setToolsPanelTopBoundary] = createContext<() => number>();

// Keeps the panel's top-left corner fully inside the viewport (minus a fixed
// margin) and below topBoundary (the app header's bottom edge) no matter what
// drag delta or window resize produced the candidate position. Pure so drag
// handling and the resize listener can both reuse it without re-deriving the
// same bounds math, and so it's unit-testable without a DOM.
export function clampToolsPanelPosition(
	x: number,
	y: number,
	panelWidth: number,
	panelHeight: number,
	viewportWidth: number,
	viewportHeight: number,
	topBoundary: number,
	margin: number = VIEWPORT_MARGIN
): ToolsPanelPosition {
	const minY = Math.max(0, topBoundary) + margin;
	const maxY = Math.max(minY, viewportHeight - panelHeight - margin);
	const marginMaxX = viewportWidth - panelWidth - margin;
	const nextX =
		marginMaxX >= margin
			? Math.min(Math.max(x, margin), marginMaxX)
			: Math.min(Math.max(x, 0), Math.max(0, viewportWidth - panelWidth));
	return {
		x: nextX,
		y: Math.min(Math.max(y, minY), maxY)
	};
}

export function clampToolsPanelWidth(
	value: number,
	viewportWidth: number,
	originX: number = 0
): number {
	const max = Math.max(MIN_TOOLS_PANEL_WIDTH, viewportWidth - Math.max(0, originX));
	return Math.min(Math.max(value, MIN_TOOLS_PANEL_WIDTH), max);
}

export function toolsPanelSizePresets(viewportWidth: number): number[] {
	return TOOLS_PANEL_SIZE_PRESET_FRACTIONS.map((fraction) =>
		Math.round(MIN_TOOLS_PANEL_WIDTH + (viewportWidth - MIN_TOOLS_PANEL_WIDTH) * fraction)
	);
}

export function nextToolsPanelSizePreset(current: number, viewportWidth: number): number {
	const presets = toolsPanelSizePresets(viewportWidth);
	return presets.find((preset) => preset > current + SIZE_PRESET_TOLERANCE) ?? presets[0];
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
	if (candidate.position !== null && !isToolsPanelPosition(candidate.position)) return false;
	// width didn't exist before the resizable-panel feature, so payloads
	// written by older sessions have it absent (not null) — accept that as
	// "not resized yet" rather than rejecting the whole stored object.
	if (candidate.width === undefined || candidate.width === null) return true;
	return Number.isFinite(candidate.width);
}

function readStoredState(): StoredToolsPanel | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isStoredToolsPanel(parsed)) return null;
		return { ...parsed, width: parsed.width ?? null };
	} catch (error) {
		logBoundaryError('toolsPanel.restore', error);
		return null;
	}
}

class ToolsPanelState {
	open = $state(true);
	// Where the user put the panel; null = not yet dragged, panel sits at its
	// CSS-anchored default corner. FloatingToolsPanel derives the drawn
	// position from it by clamping to the current viewport and app header —
	// that clamp is never written back here.
	position = $state.raw<ToolsPanelPosition | null>(null);
	// null = the CSS default (TOOLS_PANEL_WIDTH / --tools-panel-width), not yet
	// resized by the user.
	width = $state<number | null>(null);
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
			this.width =
				stored.width === null
					? null
					: clampToolsPanelWidth(stored.width, window.innerWidth, stored.position?.x ?? 0);
		}
	}

	setOpen(open: boolean): void {
		this.open = open;
		this.#persist();
	}

	// Updates the position without writing to localStorage — for high-frequency
	// callers like pointermove, where persisting on every event would hammer
	// storage for no benefit until the drag actually ends.
	updatePosition(x: number, y: number): void {
		this.position = { x, y };
	}

	setWidth(width: number): void {
		this.width = width;
		this.#persist();
	}

	// Updates the width without writing to localStorage — the resize-drag
	// counterpart to updatePosition, for the same high-frequency-pointermove
	// reason.
	updateWidth(width: number): void {
		this.width = width;
	}

	persist(): void {
		this.#persist();
	}

	#persist(): void {
		if (!browser) return;
		try {
			const payload: StoredToolsPanel = {
				open: this.open,
				position: this.position,
				width: this.width
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
		} catch (error) {
			logBoundaryError('toolsPanel.persist', error);
		}
	}
}

export const toolsPanel = new ToolsPanelState();
