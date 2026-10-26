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

import { z } from 'zod';
import {
	generationKinds,
	type GenerationEstimate,
	type GenerationKind,
	type GenerationProvider
} from '$lib/api/contract';
import { logBoundaryError } from '$lib/utils';

// Durations shift as models and hardware change, so a long-lived tab
// refetches them instead of trusting the first answer forever.
const REFRESH_AFTER_MS = 10 * 60_000;

const estimatesResponseSchema = z
	.object({
		estimates: z.array(
			z
				.object({
					kind: z.enum(generationKinds),
					provider: z.enum(['archai', 'comfyui']),
					seconds: z.number().positive()
				})
				.strict()
		)
	})
	.strict();

class GenerationEstimatesState {
	#estimates: GenerationEstimate[] = $state.raw([]);
	#loadedAt: number | null = null;
	#loading: Promise<void> | null = null;

	seconds(kind: GenerationKind, provider: GenerationProvider): number | null {
		return (
			this.#estimates.find((estimate) => estimate.kind === kind && estimate.provider === provider)
				?.seconds ?? null
		);
	}

	load(now = Date.now()): Promise<void> {
		if (this.#loading) return this.#loading;
		if (this.#loadedAt !== null && now - this.#loadedAt < REFRESH_AFTER_MS) {
			return Promise.resolve();
		}
		this.#loading = this.#fetch(now).finally(() => {
			this.#loading = null;
		});
		return this.#loading;
	}

	async #fetch(now: number): Promise<void> {
		try {
			const response = await fetch('/api/generation-estimates');
			if (!response.ok) throw new Error(`Generation estimates failed: HTTP ${response.status}`);
			const parsed = estimatesResponseSchema.safeParse(await response.json());
			if (!parsed.success) throw new Error('Generation estimates response is invalid');
			this.#estimates = parsed.data.estimates;
			this.#loadedAt = now;
		} catch (error) {
			// Progress then falls back to the flow's fixed hint; the next
			// generation retries.
			logBoundaryError('generationEstimates.load', error);
		}
	}
}

export const generationEstimates = new GenerationEstimatesState();
