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
import type { z } from 'zod';

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

// Credit amounts (balance/cost) come from archAI and repeated D1 arithmetic, so
// they can carry binary floating-point noise (e.g. 4.9399999999999995). Round for
// display only — the stored/compared values stay full-precision.
export function formatCredit(amount: number): string {
	return amount.toFixed(2);
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

// File sizes for display, in binary steps (1 KB = 1024 bytes) to match the
// upload limit, which is expressed as 8 * 1024 * 1024 bytes.
export function formatBytes(bytes: number, locale: string): string {
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return new Intl.NumberFormat(locale, {
		style: 'unit',
		unit: BYTE_UNITS[unit],
		unitDisplay: 'short',
		maximumFractionDigits: unit === 0 ? 0 : 1
	}).format(value);
}

export interface BoundaryErrorLog {
	scope: string;
	name: string;
	message: string;
	stack?: string;
	// The underlying failure an error wraps (Error's `cause`) — e.g. the
	// browser's own network error behind a "request failed" — so a log says
	// why, not just what. Only an Error cause is logged, never an arbitrary
	// value that might carry private data.
	cause?: string;
}

// `Name: message` of an error value, for building a wrapping error's message.
export function describeCause(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : 'non-Error value';
}

// Where a zod validation failed — field paths only, never the offending
// values, so a response carrying user data can't leak into logs.
export function issuePaths(error: z.ZodError): string {
	return error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
}

export function toBoundaryErrorLog(scope: string, error: unknown): BoundaryErrorLog {
	if (error instanceof Error) {
		return {
			scope,
			name: error.name || 'Error',
			message: error.message || 'Component boundary failed',
			stack: error.stack,
			...(error.cause instanceof Error ? { cause: describeCause(error.cause) } : {})
		};
	}

	return {
		scope,
		name: 'NonError',
		message: 'Component boundary failed with a non-Error value'
	};
}

export function logBoundaryError(scope: string, error: unknown): void {
	console.error('Component boundary failed:', toBoundaryErrorLog(scope, error));
}

// discardBody — a fetch response's body isn't released just because it's
// never read — cancel explicitly wherever a response is fetched but
// deliberately never consumed.
export function discardBody(response: Response): void {
	void response.body?.cancel().catch(() => {});
}

// openModal — attach helper for native <dialog> elements: opens the dialog
// as a modal and returns a cleanup that closes it if still open.
export function openModal(dialog: HTMLDialogElement): () => void {
	dialog.showModal();
	return () => {
		if (dialog.open) dialog.close();
	};
}

// Dismiss an open panel on an outside pointer press or Escape. An attachment
// factory keeps the listeners tied to the element's lifetime without an effect.
export function dismissable(
	isOpen: () => boolean,
	close: () => void,
	triggerSelector: string
): (node: HTMLElement) => () => void {
	return (node: HTMLElement) => {
		const onPointer = (event: PointerEvent) => {
			if (isOpen() && !node.contains(event.target as Node)) close();
		};
		const onKey = (event: KeyboardEvent) => {
			if (!isOpen() || event.key !== 'Escape') return;
			close();
			// Return focus to the trigger so keyboard users aren't dropped to <body>.
			node.querySelector<HTMLButtonElement>(triggerSelector)?.focus();
		};
		window.addEventListener('pointerdown', onPointer);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onPointer);
			window.removeEventListener('keydown', onKey);
		};
	};
}

export interface TabController {
	activate: (index: number) => void;
	onKeydown: (event: KeyboardEvent) => void;
}

export interface TabControllerOptions {
	itemCount: () => number;
	isDisabled?: (index: number) => boolean;
	getActiveIndex: () => number;
	setActiveIndex: (index: number) => Promise<void> | void;
	focusTab: (index: number) => void;
}

export function createTabController(options: TabControllerOptions): TabController {
	const { itemCount, isDisabled = () => false, getActiveIndex, setActiveIndex, focusTab } = options;

	function activate(index: number): void {
		if (isDisabled(index)) return;
		void Promise.resolve(setActiveIndex(index)).then(() => focusTab(index));
	}

	function onKeydown(event: KeyboardEvent): void {
		const last = itemCount() - 1;
		const selected = getActiveIndex();
		// With nothing selected, roving tabindex parks on one tab that is not
		// the active index. Arrows must move from that focused tab.
		const focused =
			selected >= 0
				? selected
				: Math.max(
						0,
						[
							...(event.currentTarget instanceof HTMLElement
								? (event.currentTarget.parentElement?.querySelectorAll('[role="tab"]') ?? [])
								: [])
						].indexOf(event.currentTarget as HTMLElement)
					);
		const current = selected >= 0 ? selected : focused;
		let next: number | null = null;

		// ArrowDown/ArrowUp mirror ArrowRight/ArrowLeft so the same controller
		// works for a horizontal tablist or a vertical one (e.g. Edit's tool
		// rail) per the ARIA APG tab pattern.
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
			let candidate = current === last ? 0 : current + 1;
			while (isDisabled(candidate) && candidate !== current) {
				candidate = candidate === last ? 0 : candidate + 1;
			}
			next = candidate;
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
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
