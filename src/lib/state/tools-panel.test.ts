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
import { clampToolsPanelPosition, toolsPanel } from './tools-panel.svelte';

describe('clampToolsPanelPosition', () => {
	it('keeps a position that already fits unchanged', () => {
		expect(clampToolsPanelPosition(200, 250, 360, 40, 1280, 800, 180, 16)).toEqual({
			x: 200,
			y: 250
		});
	});

	it('clamps the bar past the right and bottom edges', () => {
		expect(clampToolsPanelPosition(5000, 5000, 360, 40, 1280, 800, 180, 16)).toEqual({
			x: 1280 - 360 - 16,
			y: 800 - 40 - 16
		});
	});

	it('clamps the bar past the left edge and workspace header', () => {
		expect(clampToolsPanelPosition(-500, -500, 360, 40, 1280, 800, 180, 16)).toEqual({
			x: 16,
			y: 196
		});
	});

	it('uses the workspace top when the remaining working area is shorter than the bar', () => {
		expect(clampToolsPanelPosition(100, 100, 360, 400, 800, 500, 180, 16)).toEqual({
			x: 100,
			y: 196
		});
	});

	it('keeps the horizontal margin when the bar is wider than the viewport', () => {
		expect(clampToolsPanelPosition(100, 250, 2000, 200, 800, 600, 180, 16)).toEqual({
			x: 16,
			y: 250
		});
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

	it('setPosition records the dragged position', () => {
		toolsPanel.setPosition(120, 80);
		expect(toolsPanel.position).toEqual({ x: 120, y: 80 });
	});

	it('updatePosition records the position without requiring a persist call', () => {
		toolsPanel.updatePosition(200, 140);
		expect(toolsPanel.position).toEqual({ x: 200, y: 140 });
	});
});
