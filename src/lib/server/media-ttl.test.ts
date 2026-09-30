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
import { mediaCacheTtl, renderMediaTtl } from './media-ttl';

function platform(env: Partial<App.Platform['env']>): App.Platform {
	return { env } as unknown as App.Platform;
}

describe('media TTLs', () => {
	it('defaults to one year for the cache and three hours for render services', () => {
		expect(mediaCacheTtl(platform({}))).toBe(31_536_000);
		expect(mediaCacheTtl(undefined)).toBe(31_536_000);
		expect(renderMediaTtl(platform({}))).toBe(10_800);
	});

	it('reads configured lifetimes', () => {
		expect(mediaCacheTtl(platform({ MEDIA_CACHE_TTL_SECONDS: '3600' }))).toBe(3600);
		expect(renderMediaTtl(platform({ RENDER_MEDIA_TTL_SECONDS: '604800' }))).toBe(604_800);
	});

	it.each(['0', '-1', '1.5', ' 300', '9007199254740992'])('rejects invalid TTL %s', (value) => {
		expect(() => mediaCacheTtl(platform({ MEDIA_CACHE_TTL_SECONDS: value }))).toThrow(
			'MEDIA_CACHE_TTL_SECONDS is invalid'
		);
		expect(() => renderMediaTtl(platform({ RENDER_MEDIA_TTL_SECONDS: value }))).toThrow(
			'RENDER_MEDIA_TTL_SECONDS is invalid'
		);
	});

	it('enforces each maximum', () => {
		expect(() => renderMediaTtl(platform({ RENDER_MEDIA_TTL_SECONDS: '604801' }))).toThrow(
			'RENDER_MEDIA_TTL_SECONDS is invalid'
		);
		expect(() => mediaCacheTtl(platform({ MEDIA_CACHE_TTL_SECONDS: '31536001' }))).toThrow(
			'MEDIA_CACHE_TTL_SECONDS is invalid'
		);
	});
});
