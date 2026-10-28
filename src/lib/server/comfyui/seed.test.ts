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

import { describe, expect, it } from 'vitest';

import { randomSeed } from '$lib/server/comfyui/seed';

describe('randomSeed', () => {
	it('returns distinct non-negative safe integers', () => {
		const seeds = Array.from({ length: 100 }, () => randomSeed());
		for (const seed of seeds) {
			expect(Number.isSafeInteger(seed)).toBe(true);
			expect(seed).toBeGreaterThanOrEqual(0);
		}
		expect(new Set(seeds).size).toBe(seeds.length);
	});
});
