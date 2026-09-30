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

import type { SceneFilterProject } from '$lib/api/contract';

// Registered after a test's own `**/api/generated-images**` mock, so this more
// specific route answers the Scenes filter options request instead.
export async function mockSceneFilterOptions(
	page: Page,
	projects: SceneFilterProject[] = []
): Promise<void> {
	await page.route('**/api/generated-images/sessions', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ projects })
		})
	);
}
