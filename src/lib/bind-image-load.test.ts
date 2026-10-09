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

import { describe, expect, it, vi } from 'vitest';
import { bindImageLoad } from './bind-image-load';

function image(
	initialComplete: boolean,
	initialWidth: number
): HTMLImageElement & { dispatch: (type: string) => void } {
	const state = { complete: initialComplete, naturalWidth: initialWidth };
	const listeners = new Map<string, Array<() => void>>();
	return {
		get complete() {
			return state.complete;
		},
		get naturalWidth() {
			return state.naturalWidth;
		},
		addEventListener: (type: string, listener: () => void) => {
			const bucket = listeners.get(type) ?? [];
			bucket.push(listener);
			listeners.set(type, bucket);
		},
		removeEventListener: (type: string, listener: () => void) => {
			listeners.set(
				type,
				(listeners.get(type) ?? []).filter((candidate) => candidate !== listener)
			);
		},
		dispatch: (type: string) => {
			state.complete = true;
			if (type === 'error') state.naturalWidth = 0;
			for (const listener of listeners.get(type) ?? []) listener();
		}
	} as unknown as HTMLImageElement & { dispatch: (type: string) => void };
}

describe('bindImageLoad', () => {
	it('treats an already decoded image as ready without waiting for another request', async () => {
		const onReady = vi.fn();
		const onError = vi.fn();
		bindImageLoad(image(true, 32), { onReady, onError });

		await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
		expect(onError).not.toHaveBeenCalled();
	});

	it('reports a failed image and ignores a late load after cleanup', () => {
		const onReady = vi.fn();
		const onError = vi.fn();
		const node = image(false, 0);
		const stop = bindImageLoad(node, { onReady, onError });

		node.dispatch('error');
		expect(onError).toHaveBeenCalledOnce();
		stop();
		node.dispatch('load');
		expect(onReady).not.toHaveBeenCalled();
	});
});
