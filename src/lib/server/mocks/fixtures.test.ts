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

import { describe, it, expect } from 'vitest';
import { mockRender, mockUpload } from '$lib/server/mocks/fixtures';

describe('mock fixtures match the API contract', () => {
	it('upload', () => {
		expect(mockUpload()).toMatchObject({
			url: expect.any(String),
			mime: expect.any(String),
			size: expect.any(Number)
		});
	});

	it('render', () => {
		expect(mockRender()).toMatchObject({
			outputUrl: expect.any(String),
			cost: expect.any(Number),
			balance: expect.any(Number)
		});
	});
});
