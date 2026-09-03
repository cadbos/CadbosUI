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
import { MediaAccessState } from './media-access.svelte';

describe('media access', () => {
	it('normalizes URLs by key and clears retained references', () => {
		const state = new MediaAccessState();
		const original = state.normalize({
			key: 'cadbos-uploads/one',
			url: 'https://s3.example.test/one?old'
		});
		const updated = state.normalize({
			key: 'cadbos-uploads/one',
			url: 'https://s3.example.test/one?new'
		});

		expect(updated).toBe(original);
		expect(state.get('cadbos-uploads/one')).toBe(original);
		expect(original.url).toBe('https://s3.example.test/one?new');

		state.clear();
		expect(original.url).toBe('');
		expect(state.get('cadbos-uploads/one')).toBeUndefined();
	});

	it('keeps matching object names in different buckets separate', () => {
		const state = new MediaAccessState();
		const uploads = state.normalize({
			key: 'cadbos-uploads/shared.webp',
			url: 'https://uploads.example.test/shared.webp'
		});
		const archive = state.normalize({
			key: 'archive/shared.webp',
			url: 'https://archive.example.test/shared.webp'
		});

		expect(state.get(uploads.key)).toBe(uploads);
		expect(state.get(archive.key)).toBe(archive);
	});
});
