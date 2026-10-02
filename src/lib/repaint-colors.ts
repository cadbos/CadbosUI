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

// The only color shape the repaint tool stores, sends and accepts: an opaque
// sRGB color as lowercase `#rrggbb`. The server turns it into the solid
// swatch image the workflow reads as its second picture.
export const REPAINT_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export interface RepaintColorPreset {
	hex: string;
	label: TranslationKey;
}

export const REPAINT_COLOR_PRESETS: readonly RepaintColorPreset[] = [
	{ hex: '#f4f1ea', label: 'repaint.color.warmWhite' },
	{ hex: '#e8dcc4', label: 'repaint.color.ivory' },
	{ hex: '#d8c3a5', label: 'repaint.color.beige' },
	{ hex: '#b8ad9e', label: 'repaint.color.greige' },
	{ hex: '#c9cbcb', label: 'repaint.color.lightGray' },
	{ hex: '#4a4e54', label: 'repaint.color.graphite' },
	{ hex: '#a3b19b', label: 'repaint.color.sage' },
	{ hex: '#6b7046', label: 'repaint.color.olive' },
	{ hex: '#8fa6b8', label: 'repaint.color.dustyBlue' },
	{ hex: '#2f3e5c', label: 'repaint.color.navy' },
	{ hex: '#c46a4a', label: 'repaint.color.terracotta' },
	{ hex: '#d9a9a0', label: 'repaint.color.dustyPink' }
];

export const DEFAULT_REPAINT_COLOR = REPAINT_COLOR_PRESETS[0].hex;
