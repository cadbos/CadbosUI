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

import { afterEach, describe, expect, it } from 'vitest';
import { generationOverlay } from './generation-overlay.svelte';

afterEach(() => {
	generationOverlay.stop();
});

describe('generation overlay', () => {
	it('stays active until every generation flow stops', () => {
		generationOverlay.start('generationOverlay.render');
		generationOverlay.start(
			'generationOverlay.objectReplacement',
			'generationOverlay.objectReplacementDetail'
		);

		expect(generationOverlay.active).toBe(true);
		expect(generationOverlay.messageKey).toBe('generationOverlay.objectReplacement');
		expect(generationOverlay.detailKey).toBe('generationOverlay.objectReplacementDetail');

		generationOverlay.stop();

		expect(generationOverlay.active).toBe(true);
		expect(generationOverlay.messageKey).toBe('generationOverlay.objectReplacement');
		expect(generationOverlay.detailKey).toBe('generationOverlay.objectReplacementDetail');

		generationOverlay.stop();

		expect(generationOverlay.active).toBe(false);
		expect(generationOverlay.messageKey).toBeNull();
		expect(generationOverlay.detailKey).toBeNull();
	});
});
