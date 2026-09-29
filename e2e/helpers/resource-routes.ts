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

import type { Page } from '@playwright/test';
import type { ResourceDetailResponse } from '$lib/api/contract';

// GET /api/resources/[key] for one resource — the key travels as a single
// URI-encoded path segment, so '*' matches exactly one resource's page.
export async function mockResourceDetail(
	page: Page,
	body: Omit<ResourceDetailResponse, 'pagination'>
): Promise<void> {
	await page.route(`**/api/resources/${encodeURIComponent(body.image.key)}?**`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				...body,
				pagination: { offset: 0, size: 30, hasMore: false }
			} satisfies ResourceDetailResponse)
		});
	});
}
