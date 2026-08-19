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

// Real UUIDs, not readable placeholders — #createProjectSession validates the
// provisioning response's id with z.uuid(), which a string like 'e2e-project'
// fails.
export const E2E_PROJECT_ID = '00000000-0000-4000-8000-000000000900';
export const E2E_SESSION_ID = '00000000-0000-4000-8000-000000000901';

// Every generate call lazily provisions a project+session on first use
// (RequestState#ensureProjectSession) — mocked here so submissions don't hang
// waiting on the real, unmocked /api/projects endpoints. Shared across every
// spec that submits a generation, so the fixture stays in one place.
export async function mockProjectSessionRoutes(page: Page): Promise<void> {
	await page.route('**/api/projects', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		await route.fulfill({
			status: 201,
			contentType: 'application/json',
			body: JSON.stringify({
				id: E2E_PROJECT_ID,
				title: 'Untitled',
				createdAt: Date.now(),
				updatedAt: Date.now()
			})
		});
	});
	await page.route(`**/api/projects/${E2E_PROJECT_ID}/sessions`, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		await route.fulfill({
			status: 201,
			contentType: 'application/json',
			body: JSON.stringify({
				id: E2E_SESSION_ID,
				title: '',
				createdAt: Date.now(),
				updatedAt: Date.now()
			})
		});
	});
}
