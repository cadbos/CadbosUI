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

import { adminGenerationDetailResponseSchema } from '$lib/api/admin-generation';
import type { AdminGenerationDetailResponse } from '$lib/api/contract';

type InspectionStatus =
	| 'idle'
	| 'loading'
	| 'ready'
	| 'unauthorized'
	| 'forbidden'
	| 'not-found'
	| 'error';

class AdminGenerationState {
	detail = $state.raw<AdminGenerationDetailResponse | null>(null);
	status = $state<InspectionStatus>('idle');
	#abort: AbortController | null = null;

	async load(id: string): Promise<void> {
		this.clear();
		const controller = new AbortController();
		this.#abort = controller;
		this.status = 'loading';
		let stage: 'request' | 'http' | 'json' | 'schema' = 'request';
		let status: number | null = null;
		try {
			const response = await fetch(`/api/usage/generations/${encodeURIComponent(id)}`, {
				signal: controller.signal
			});
			if (controller.signal.aborted) return;
			stage = 'http';
			status = response.status;
			if (response.status === 401 || response.status === 403 || response.status === 404) {
				this.status =
					response.status === 401
						? 'unauthorized'
						: response.status === 403
							? 'forbidden'
							: 'not-found';
				return;
			}
			if (!response.ok)
				throw new Error(`generation inspection request failed: HTTP ${response.status}`);
			stage = 'json';
			const body: unknown = await response.json();
			stage = 'schema';
			const parsed = adminGenerationDetailResponseSchema.safeParse(body);
			if (controller.signal.aborted) return;
			if (!parsed.success) throw new Error('generation inspection response failed validation');
			this.detail = parsed.data;
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.status = 'error';
			console.error('Generation inspection failed:', {
				stage,
				status,
				errorType: error instanceof Error ? error.name : typeof error
			});
		} finally {
			if (this.#abort === controller) this.#abort = null;
		}
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.detail = null;
		this.status = 'idle';
	}
}

export const adminGeneration = new AdminGenerationState();
