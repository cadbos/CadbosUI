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

export async function mockFeaturebase(page: Page): Promise<void> {
	await page.route(
		'https://do.featurebase.app/v1/organization/by-id/test-featurebase-app-id',
		(route) =>
			route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					slug: 'cadbos-test',
					modules: { support: false }
				})
			})
	);
	await page.route('https://do.featurebase.app/js/sdk.js', (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: `
				window.__featurebaseCalls = [];
				const queuedCalls = window.Featurebase?.q ? [...window.Featurebase.q] : [];
				window.Featurebase = (...args) => {
					window.__featurebaseCalls.push(args);
					if (args[0] === 'initialize_feedback_widget') {
						document.addEventListener('click', (event) => {
							if (event.target.closest('[data-featurebase-feedback]')) {
								document.documentElement.dataset.featurebaseFeedbackOpened = 'true';
							}
						});
					}
				};
				queuedCalls.forEach((args) => window.Featurebase(...args));
			`
		})
	);
}
