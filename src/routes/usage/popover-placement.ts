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

const VIEWPORT_GUTTER = 16;
const GAP = 8;

export interface PopoverPlacement {
	top: number;
	left: number;
	// Where the trigger's centre falls inside the popover, for its arrow.
	arrowLeft: number;
}

// A top-layer popover sits outside any scrolling table, so it is placed under
// its trigger in document coordinates, lined up with the trigger's start or
// end edge and kept inside the viewport.
export function placeBelow(
	trigger: HTMLElement,
	maxWidthRem: number,
	align: 'start' | 'end'
): PopoverPlacement {
	const rect = trigger.getBoundingClientRect();
	const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
	const viewportWidth = document.documentElement.clientWidth;
	const width = Math.min(maxWidthRem * rem, viewportWidth - 2 * VIEWPORT_GUTTER);
	const preferred = align === 'end' ? rect.right - width : rect.left;
	const left = Math.min(
		Math.max(VIEWPORT_GUTTER, preferred),
		viewportWidth - VIEWPORT_GUTTER - width
	);
	return {
		top: rect.bottom + window.scrollY + GAP,
		left: left + window.scrollX,
		arrowLeft: rect.left + rect.width / 2 - left
	};
}
