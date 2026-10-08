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

import { beforeEach, describe, expect, it } from 'vitest';
import {
	clampToolsPanelPosition,
	clampToolsPanelWidth,
	MIN_TOOLS_PANEL_WIDTH,
	nextToolsPanelSizePreset,
	toolsPanel,
	toolsPanelSizePresets
} from './tools-panel.svelte';

describe('clampToolsPanelPosition', () => {
	it('keeps a position that already fits unchanged', () => {
		expect(clampToolsPanelPosition(200, 150, 360, 400, 1280, 800, 0, 16)).toEqual({
			x: 200,
			y: 150
		});
	});

	it('clamps a position dragged past the right/bottom edge', () => {
		expect(clampToolsPanelPosition(5000, 5000, 360, 400, 1280, 800, 0, 16)).toEqual({
			x: 1280 - 360 - 16,
			y: 800 - 400 - 16
		});
	});

	it('clamps a position dragged past the left/top edge', () => {
		expect(clampToolsPanelPosition(-500, -500, 360, 400, 1280, 800, 0, 16)).toEqual({
			x: 16,
			y: 16
		});
	});

	it('sits flush with the left edge when the panel is wider than the viewport', () => {
		expect(clampToolsPanelPosition(100, 100, 2000, 2000, 800, 600, 0, 16)).toEqual({
			x: 0,
			y: 16
		});
	});

	it('sits flush with both screen edges when the panel is exactly as wide as the viewport', () => {
		expect(clampToolsPanelPosition(40, 100, 800, 400, 800, 600, 0, 16)).toEqual({
			x: 0,
			y: 100
		});
	});

	it('keeps a position dragged over the header just below it', () => {
		expect(clampToolsPanelPosition(200, 20, 360, 400, 1280, 800, 72, 16)).toEqual({
			x: 200,
			y: 72 + 16
		});
	});

	it('keeps the panel below the header even when it is too tall to fit', () => {
		expect(clampToolsPanelPosition(200, 0, 360, 2000, 1280, 800, 72, 16)).toEqual({
			x: 200,
			y: 72 + 16
		});
	});
});

describe('clampToolsPanelWidth', () => {
	it('keeps the minimum and leaves a margin so the resize handle stays on screen', () => {
		expect(clampToolsPanelWidth(10, 1280)).toBe(MIN_TOOLS_PANEL_WIDTH);
		expect(clampToolsPanelWidth(5000, 1280)).toBe(1280 - 32);
		expect(clampToolsPanelWidth(5000, 400)).toBe(400 - 32);
	});

	it('keeps a panel widened against the right edge inset by that same margin', () => {
		const width = clampToolsPanelWidth(900, 1280);
		const placed = clampToolsPanelPosition(1100, 120, width, 400, 1280, 800, 0, 16);
		expect(placed.x + width).toBe(1280 - 16);
	});
});

describe('nextToolsPanelSizePreset', () => {
	const viewport = 1280;
	const presets = toolsPanelSizePresets(viewport);

	it('offers three sizes between the minimum and the viewport', () => {
		expect(presets).toHaveLength(3);
		expect(presets[0]).toBeGreaterThan(MIN_TOOLS_PANEL_WIDTH);
		expect(presets[2]).toBeLessThan(viewport);
		expect(presets[0]).toBeLessThan(presets[1]);
		expect(presets[1]).toBeLessThan(presets[2]);
	});

	it('steps to the next wider preset and wraps to the smallest', () => {
		expect(nextToolsPanelSizePreset(MIN_TOOLS_PANEL_WIDTH, viewport)).toBe(presets[0]);
		expect(nextToolsPanelSizePreset(presets[0], viewport)).toBe(presets[1]);
		expect(nextToolsPanelSizePreset(presets[1], viewport)).toBe(presets[2]);
		expect(nextToolsPanelSizePreset(presets[2], viewport)).toBe(presets[0]);
	});
});

describe('toolsPanel store', () => {
	beforeEach(() => {
		toolsPanel.setOpen(true);
		toolsPanel.position = null;
	});

	it('defaults to open with no dragged position', () => {
		expect(toolsPanel.open).toBe(true);
		expect(toolsPanel.position).toBeNull();
	});

	it('setOpen toggles the open flag', () => {
		toolsPanel.setOpen(false);
		expect(toolsPanel.open).toBe(false);
		toolsPanel.setOpen(true);
		expect(toolsPanel.open).toBe(true);
	});

	it('updatePosition records the position without requiring a persist call', () => {
		toolsPanel.updatePosition(200, 140);
		expect(toolsPanel.position).toEqual({ x: 200, y: 140 });
	});
});
