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

import type { PhotoAdjustments } from '$lib/photo-adjustments';
import type { OutputFormat } from '$lib/api/contract';
import type { PhotoWorkerRequest, PhotoWorkerResponse } from '$lib/photo-processing.worker';

export async function processPhoto(
	url: string,
	settings: PhotoAdjustments,
	maxEdge?: number,
	signal?: AbortSignal,
	format?: OutputFormat
): Promise<Blob> {
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error('Photo source unavailable');
	const image = await response.blob();
	signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./photo-processing.worker.ts', import.meta.url), {
			type: 'module'
		});
		const cleanup = (): void => {
			worker.terminate();
			signal?.removeEventListener('abort', abort);
		};
		const abort = (): void => {
			cleanup();
			reject(new DOMException('Photo processing cancelled', 'AbortError'));
		};
		worker.onmessage = (event: MessageEvent<PhotoWorkerResponse>): void => {
			cleanup();
			if ('error' in event.data) reject(new Error(event.data.error));
			else resolve(event.data.blob);
		};
		worker.onerror = (): void => {
			cleanup();
			reject(new Error('Photo worker failed'));
		};
		signal?.addEventListener('abort', abort, { once: true });
		worker.postMessage({ image, settings, maxEdge, format } satisfies PhotoWorkerRequest);
	});
}

export function createPhotoPreview(
	url: string,
	signal: AbortSignal
): (settings: PhotoAdjustments) => Promise<Blob> {
	const worker = new Worker(new URL('./photo-processing.worker.ts', import.meta.url), {
		type: 'module'
	});
	let source: Promise<Blob> | undefined;
	let initialized = false;
	signal.addEventListener('abort', () => worker.terminate(), { once: true });
	return async (settings): Promise<Blob> => {
		signal.throwIfAborted();
		let image: Blob | undefined;
		if (!initialized) {
			source ??= fetch(url, { signal }).then(async (response) => {
				if (!response.ok) throw new Error('Photo source unavailable');
				return response.blob();
			});
			image = await source;
		}
		signal.throwIfAborted();
		return new Promise((resolve, reject) => {
			const cleanup = (): void => {
				signal.removeEventListener('abort', abort);
				worker.onmessage = null;
				worker.onerror = null;
			};
			const abort = (): void => {
				cleanup();
				reject(new DOMException('Photo processing cancelled', 'AbortError'));
			};
			worker.onmessage = (event: MessageEvent<PhotoWorkerResponse>): void => {
				cleanup();
				if ('error' in event.data) reject(new Error(event.data.error));
				else {
					initialized = true;
					resolve(event.data.blob);
				}
			};
			worker.onerror = (): void => {
				cleanup();
				reject(new Error('Photo worker failed'));
			};
			signal.addEventListener('abort', abort, { once: true });
			worker.postMessage({ image, settings, maxEdge: 1600 } satisfies PhotoWorkerRequest);
		});
	};
}
