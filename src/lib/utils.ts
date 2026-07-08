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

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

// Credit amounts (balance/cost) come from archAI and repeated D1 arithmetic, so
// they can carry binary floating-point noise (e.g. 4.9399999999999995). Round for
// display only — the stored/compared values stay full-precision.
export function formatCredit(amount: number): string {
	return amount.toFixed(2);
}

export interface TabController {
	activate: (index: number) => void;
	onKeydown: (event: KeyboardEvent) => void;
}

export interface TabControllerOptions {
	itemCount: () => number;
	isDisabled?: (index: number) => boolean;
	getActiveIndex: () => number;
	setActiveIndex: (index: number) => void;
	focusTab: (index: number) => void;
}

export function createTabController(options: TabControllerOptions): TabController {
	const { itemCount, isDisabled = () => false, getActiveIndex, setActiveIndex, focusTab } = options;

	function activate(index: number): void {
		if (isDisabled(index)) return;
		setActiveIndex(index);
		focusTab(index);
	}

	function onKeydown(event: KeyboardEvent): void {
		const last = itemCount() - 1;
		const current = getActiveIndex();
		let next: number | null = null;

		if (event.key === 'ArrowRight') {
			let candidate = current === last ? 0 : current + 1;
			while (isDisabled(candidate) && candidate !== current) {
				candidate = candidate === last ? 0 : candidate + 1;
			}
			next = candidate;
		} else if (event.key === 'ArrowLeft') {
			let candidate = current === 0 ? last : current - 1;
			while (isDisabled(candidate) && candidate !== current) {
				candidate = candidate === 0 ? last : candidate - 1;
			}
			next = candidate;
		} else if (event.key === 'Home') {
			for (let i = 0; i <= last; i++) {
				if (!isDisabled(i)) {
					next = i;
					break;
				}
			}
		} else if (event.key === 'End') {
			for (let i = last; i >= 0; i--) {
				if (!isDisabled(i)) {
					next = i;
					break;
				}
			}
		}

		if (next !== null && next !== current) {
			event.preventDefault();
			activate(next);
		}
	}

	return { activate, onKeydown };
}
