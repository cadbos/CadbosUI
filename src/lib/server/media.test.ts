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
import { makeDb } from '$lib/server/testing/d1-shim';
import { setBucketUrl } from '$lib/server/testing/generation-fixtures';
import { getOrCreateMedia, mediaUrl } from '$lib/server/media';

describe('media repository', () => {
	it('normalizes default HTTPS ports before matching buckets and extracting filenames', async () => {
		const db = makeDb();
		await setBucketUrl(db, 'cadbos-uploads', 'https://uploads.example.test');

		const media = await getOrCreateMedia(
			db,
			'https://uploads.example.test:443/default-port.webp',
			''
		);

		expect(media.bucket.name).toBe('cadbos-uploads');
		expect(media.filename).toBe('default-port.webp');
		expect(mediaUrl(media.bucket.url, media.filename)).toBe(
			'https://uploads.example.test/default-port.webp'
		);
	});

	it('normalizes checksums, clears invalid/conflicting values, and registers external buckets', async () => {
		const db = makeDb();
		await setBucketUrl(db, 'cadbos-uploads', 'https://uploads.example.test');
		const uppercase = await getOrCreateMedia(
			db,
			'https://uploads.example.test/uppercase.webp',
			'A'.repeat(64)
		);
		expect(uppercase.checksum).toBe('a'.repeat(64));

		const invalid = await getOrCreateMedia(
			db,
			'https://uploads.example.test/invalid.webp',
			'not-hexadecimal'
		);
		expect(invalid.checksum).toBe('');

		const first = await getOrCreateMedia(
			db,
			'https://images.example.test/result.webp',
			'1'.repeat(64)
		);
		const conflicting = await getOrCreateMedia(
			db,
			'https://images.example.test/result.webp',
			'2'.repeat(64)
		);
		expect(conflicting).toMatchObject({ id: first.id, checksum: '' });
		expect(conflicting.bucket.name).toBe('external:https://images.example.test');
		expect(mediaUrl(conflicting.bucket.url, conflicting.filename)).toBe(
			'https://images.example.test/result.webp'
		);
	});
});
