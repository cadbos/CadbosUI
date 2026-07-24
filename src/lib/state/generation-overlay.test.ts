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
import { generationOverlay } from './generation-overlay.svelte';

describe('generation overlay', () => {
	it('stays active until every generation flow stops', () => {
		const renderFlow = generationOverlay.start('generationOverlay.render');
		const objectReplacementFlow = generationOverlay.start(
			'generationOverlay.objectReplacement',
			'generationOverlay.objectReplacementDetail'
		);

		expect(generationOverlay.active).toBe(true);
		expect(generationOverlay.messageKey).toBe('generationOverlay.objectReplacement');
		expect(generationOverlay.detailKey).toBe('generationOverlay.objectReplacementDetail');

		generationOverlay.stop(objectReplacementFlow);

		expect(generationOverlay.active).toBe(true);
		expect(generationOverlay.messageKey).toBe('generationOverlay.render');
		expect(generationOverlay.detailKey).toBeNull();

		generationOverlay.stop(renderFlow);

		expect(generationOverlay.active).toBe(false);
		expect(generationOverlay.messageKey).toBeNull();
		expect(generationOverlay.detailKey).toBeNull();
	});

	it('restores the still-active flow label when a more recently started flow finishes first', () => {
		const objectReplacementFlow = generationOverlay.start(
			'generationOverlay.objectReplacement',
			'generationOverlay.objectReplacementDetail'
		);
		const renderFlow = generationOverlay.start('generationOverlay.render');

		expect(generationOverlay.messageKey).toBe('generationOverlay.render');

		generationOverlay.stop(renderFlow);

		expect(generationOverlay.active).toBe(true);
		expect(generationOverlay.messageKey).toBe('generationOverlay.objectReplacement');
		expect(generationOverlay.detailKey).toBe('generationOverlay.objectReplacementDetail');

		generationOverlay.stop(objectReplacementFlow);

		expect(generationOverlay.active).toBe(false);
	});
});
