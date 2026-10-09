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

function scrollParent(node: HTMLElement): Element | null {
	let current = node.parentElement;
	while (current && current !== document.documentElement) {
		const { overflowY } = getComputedStyle(current);
		if (overflowY === 'auto' || overflowY === 'scroll') return current;
		current = current.parentElement;
	}
	return null;
}

export function revealNearScrollParent(node: HTMLElement, onVisible: () => void): () => void {
	const root = scrollParent(node);
	if (!root || typeof IntersectionObserver === 'undefined') {
		onVisible();
		return () => {};
	}

	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			onVisible();
			observer.disconnect();
		},
		{ root, rootMargin: '200px 0px' }
	);
	observer.observe(node);
	return () => observer.disconnect();
}
