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
import { createClientIntegrityManifest } from './client-integrity-plugin';

describe('createClientIntegrityManifest', () => {
	it('hashes JavaScript and CSS output with SHA-384 in path order', () => {
		const manifest = createClientIntegrityManifest([
			{ fileName: '_app/image.svg', contents: '<svg />' },
			{ fileName: '_app/immutable/app.js', contents: 'export {};' },
			{ fileName: '_app/immutable/app.css', contents: 'body{}' }
		]);

		expect(manifest).toEqual({
			'/_app/immutable/app.css':
				'sha384-myyg/hQ74aSgjBBvVME/QXAXEkT4Y9dHbVQ5C0lIyGpldvNLJV2IWc5ElXbqLi06',
			'/_app/immutable/app.js':
				'sha384-OURA3k5hJ74BsGlX4ksLSFQSEcbEi1C7beG3lEqFBTVv+fXU25n0GbzRVMFK1W0P'
		});
	});
});
