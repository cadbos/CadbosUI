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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from './+layout.server';

type LoadEvent = Parameters<typeof load>[0];

function loadLayout(featurebaseAppId?: string): ReturnType<typeof load> {
	return load({
		platform: { env: { FEATUREBASE_APP_ID: featurebaseAppId } }
	} as LoadEvent);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('root layout Featurebase configuration', () => {
	it('returns a configured app ID without logging an error', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(loadLayout('  app-id  ')).toEqual({ featurebaseAppId: 'app-id' });
		expect(error).not.toHaveBeenCalled();
	});

	it.each([undefined, '', '   '])('disables Featurebase when the app ID is %j', (appId) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(loadLayout(appId)).toEqual({ featurebaseAppId: null });
		expect(error).toHaveBeenCalledWith(
			'Featurebase SDK disabled: FEATUREBASE_APP_ID is not configured'
		);
	});
});
