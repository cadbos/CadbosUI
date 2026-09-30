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
import { mediaKey } from '$lib/server/media';
import { TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';
import { MediaAccessState } from './media-access.svelte';

describe('media access', () => {
	it('registers each link once by key and clears on demand', () => {
		const state = new MediaAccessState();
		const key = mediaKey(TEST_S3_BUCKET.name, 'one');
		const original = state.normalize({ key, url: `/api/media/${key}` });
		const repeated = state.normalize({ key, url: `/api/media/${key}` });

		expect(repeated).toBe(original);
		expect(state.get(key)).toBe(original);

		state.clear();
		expect(state.get(key)).toBeUndefined();
	});

	it('keeps matching object names in different buckets separate', () => {
		const state = new MediaAccessState();
		const uploads = state.normalize({
			key: mediaKey(TEST_S3_BUCKET.name, 'shared.webp'),
			url: `/api/media/${mediaKey(TEST_S3_BUCKET.name, 'shared.webp')}`
		});
		const archive = state.normalize({
			key: 'archive/shared.webp',
			url: '/api/media/archive/shared.webp'
		});

		expect(state.get(uploads.key)).toBe(uploads);
		expect(state.get(archive.key)).toBe(archive);
	});
});
