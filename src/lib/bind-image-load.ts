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

export interface ImageLoadHandlers {
	onReady: (image: HTMLImageElement) => void;
	onError: () => void;
}

export function bindImageLoad(node: HTMLImageElement, handlers: ImageLoadHandlers): () => void {
	let settled = false;

	const finish = (ready: boolean): void => {
		if (settled) return;
		settled = true;
		if (ready) handlers.onReady(node);
		else handlers.onError();
	};

	const sync = (): void => {
		if (!node.complete) return;
		finish(node.naturalWidth > 0);
	};

	node.addEventListener('load', sync);
	node.addEventListener('error', sync);
	if (node.complete) queueMicrotask(sync);

	return () => {
		settled = true;
		node.removeEventListener('load', sync);
		node.removeEventListener('error', sync);
	};
}
