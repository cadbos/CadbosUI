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
		expect(clampToolsPanelPosition(200, 150, 360, 400, 1280, 800, 16)).toEqual({
			x: 200,
			y: 150
		});
	});

	it('clamps a position dragged past the right/bottom edge', () => {
		expect(clampToolsPanelPosition(5000, 5000, 360, 400, 1280, 800, 16)).toEqual({
			x: 1280 - 360 - 16,
			y: 800 - 400 - 16
		});
	});

	it('clamps a position dragged past the left/top edge', () => {
		expect(clampToolsPanelPosition(-500, -500, 360, 400, 1280, 800, 16)).toEqual({
			x: 16,
			y: 16
		});
	});

	it('falls back to the margin when the panel is wider than the viewport', () => {
		// A panel wider than the viewport minus margins has no valid "fits fully
		// inside" position — clamp to the margin instead of an inverted range.
		expect(clampToolsPanelPosition(100, 100, 2000, 2000, 800, 600, 16)).toEqual({
			x: 16,
			y: 16
		});
	});
});

describe('toolsPanel store', () => {
	beforeEach(() => {
		toolsPanel.setOpen(true);
	});

	it('defaults to open with no dragged position', () => {
		expect(toolsPanel.open).toBe(true);
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
});
