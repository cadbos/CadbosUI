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
import { normalizeProfileUpdate } from './auth.svelte';

describe('normalizeProfileUpdate', () => {
	it('trims, clamps, and nulls Cadbos profile names before submit', () => {
		expect(
			normalizeProfileUpdate({
				firstName: '  Ada  ',
				lastName: `  ${'L'.repeat(90)}  `
			})
		).toEqual({
			firstName: 'Ada',
			lastName: 'L'.repeat(80)
		});

		expect(normalizeProfileUpdate({ firstName: '   ', lastName: null })).toEqual({
			firstName: null,
			lastName: null
		});
	});

	it('keeps omitted profile fields omitted', () => {
		expect(normalizeProfileUpdate({ firstName: ' Grace ' })).toEqual({ firstName: 'Grace' });
	});
});
