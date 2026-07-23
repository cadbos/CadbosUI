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
			// Mirrors the real runtime's undocumented button DOM (verified against
			// do.featurebase.app/js/sdk.{js,css}): a
			// .fb-feedback-widget-feedback-button-container > .fb-feedback-widget
			// -feedback-button[-br|-bl|-left|-right], toggled by
			// initialize_feedback_widget / destroy_feedback_widget and opened by
			// clicking the button. We don't load the real sdk.css here, so the
			// button gets a minimal inline style standing in for it — just enough
			// to be visible/clickable — rather than the app supplying any CSS of
			// its own for a widget it doesn't otherwise style.
			body: `
				window.__featurebaseCalls = [];
				const queuedCalls = window.Featurebase?.q ? [...window.Featurebase.q] : [];
				const placementSuffix = { 'bottom-left': 'bl', left: 'left', right: 'right' };
				window.Featurebase = (...args) => {
					window.__featurebaseCalls.push(args);
					if (args[0] === 'initialize_feedback_widget') {
						if (!document.querySelector('.fb-feedback-widget-feedback-button-container')) {
							const container = document.createElement('div');
							container.className = 'fb-feedback-widget-feedback-button-container';
							const button = document.createElement('div');
							const suffix = placementSuffix[args[1]?.placement] ?? 'br';
							button.className = 'fb-feedback-widget-feedback-button fb-feedback-widget-feedback-button-' + suffix;
							button.setAttribute('role', 'button');
							button.style.cssText =
								'position:fixed;right:24px;bottom:24px;width:40px;height:40px;background:#000;';
							container.appendChild(button);
							document.body.appendChild(container);
						}
					}
					if (args[0] === 'destroy_feedback_widget') {
						document.querySelector('.fb-feedback-widget-feedback-button-container')?.remove();
					}
				};
				document.addEventListener('click', (event) => {
					if (event.target.closest('.fb-feedback-widget-feedback-button')) {
						document.documentElement.dataset.featurebaseFeedbackOpened = 'true';
					}
				});
				queuedCalls.forEach((args) => window.Featurebase(...args));
			`
		})
	);
}
