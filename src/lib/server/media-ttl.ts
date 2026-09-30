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

const MAX_RENDER_MEDIA_TTL_SECONDS = 604_800;
const MAX_MEDIA_CACHE_TTL_SECONDS = 31_536_000;

function ttl(value: string | undefined, name: string, fallback: number, max: number): number {
	if (value === undefined) return fallback;
	if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} is invalid`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > max) throw new Error(`${name} is invalid`);
	return parsed;
}

// Lifetime of the presigned URLs handed to render services, which fetch input
// images after the request that created them has returned.
export function renderMediaTtl(platform: App.Platform | undefined): number {
	return ttl(
		platform?.env?.RENDER_MEDIA_TTL_SECONDS,
		'RENDER_MEDIA_TTL_SECONDS',
		10_800,
		MAX_RENDER_MEDIA_TTL_SECONDS
	);
}

// `max-age` of /api/media responses in the browser cache.
export function mediaCacheTtl(platform: App.Platform | undefined): number {
	return ttl(
		platform?.env?.MEDIA_CACHE_TTL_SECONDS,
		'MEDIA_CACHE_TTL_SECONDS',
		MAX_MEDIA_CACHE_TTL_SECONDS,
		MAX_MEDIA_CACHE_TTL_SECONDS
	);
}
