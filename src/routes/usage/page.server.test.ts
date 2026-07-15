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
import { load } from './+page.server';

type LoadEvent = Parameters<typeof load>[0];

function call(pubkeyViewer?: string): ReturnType<typeof load> {
	return load({
		platform:
			pubkeyViewer === undefined
				? undefined
				: ({ env: { PUBKEY_VIEWER: pubkeyViewer } } as App.Platform)
	} as LoadEvent);
}

describe('usage page viewer configuration', () => {
	it('uses a configured template containing a pubkey placeholder', () => {
		expect(call('https://explorer.example/p/{}')).toEqual({
			pubkeyViewer: 'https://explorer.example/p/{}'
		});
	});

	it('uses Primal when the viewer is not configured', () => {
		expect(call()).toEqual({ pubkeyViewer: 'https://primal.net/p/{}' });
	});

	it('uses Primal when the configured viewer has no pubkey placeholder', () => {
		expect(call('https://explorer.example/p')).toEqual({
			pubkeyViewer: 'https://primal.net/p/{}'
		});
	});
});
