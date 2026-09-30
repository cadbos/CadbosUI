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

import { expect, test as base } from '@playwright/test';

import type { HealthSnapshot } from '$lib/api/contract';

const HEALTHY_SNAPSHOT: HealthSnapshot = {
	status: 'healthy',
	timestamp: '2026-08-12T10:00:00.000Z',
	services: {
		archai: { status: 'healthy', latencyMs: 12 },
		assets: { status: 'healthy', latencyMs: 13 },
		comfyui: { status: 'healthy', latencyMs: 14 },
		d1: { status: 'healthy', latencyMs: 15 },
		nostr: { status: 'healthy', latencyMs: 16, reachable: 4, total: 4 },
		s3: { status: 'healthy', latencyMs: 17 }
	}
};

export const test = base.extend({
	page: async ({ page }, use) => {
		await page.route('**/healthz', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'cache-control': 'public, max-age=60' },
				body: JSON.stringify(HEALTHY_SNAPSHOT)
			});
		});

		// Mocked API payloads reference /api/media links that have no stored media
		// behind them; serve a placeholder so images resolve instead of hitting the server.
		await page.route('**/api/media/**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'image/svg+xml',
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#d9d1c7"/></svg>'
			});
		});

		await use(page);
	}
});

export { expect };
