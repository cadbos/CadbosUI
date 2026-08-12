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

import { expect, test } from './fixtures';
import { ru } from '$lib/i18n/locales/ru';

const javaScriptAsset = /\/_app\/immutable\/.*\.js(?:\?.*)?$/;
const cssAsset = /\/_app\/immutable\/.*\.css(?:\?.*)?$/;
const pagePath = '/create/interior';

async function holdClientReady(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Reflect.set(window, '__cadbosHoldClientReady', true);
		window.addEventListener('cadbos:client-ready', (event) => {
			if (Reflect.get(window, '__cadbosHoldClientReady')) event.stopImmediatePropagation();
		});
	});
}

async function releaseClientReady(page: Page): Promise<void> {
	await page.evaluate(() => {
		Reflect.set(window, '__cadbosHoldClientReady', false);
		window.dispatchEvent(new CustomEvent('cadbos:client-ready'));
	});
}

test('adds integrity metadata to the production page resources', async ({ request }) => {
	const response = await request.get(pagePath, {
		headers: { accept: 'text/html' }
	});
	const html = await response.text();
	const linkHeader = response.headers()['link'] ?? '';
	const failureMarkup = html.match(/<div\s+id="cadbos-client-load-error"[^>]*>/)?.[0];

	expect(response.ok()).toBe(true);
	expect(html).toContain('data-client-integrity="enabled"');
	expect(failureMarkup).toBeDefined();
	expect(failureMarkup).not.toContain('hidden');
	expect(html).toMatch(/href=""\s+data-sveltekit-reload/);
	expect(html).toMatch(
		/<link[^>]+href="[^"]+\.css"[^>]+integrity="sha384-[A-Za-z0-9+/]{64}"[^>]+crossorigin="anonymous"/
	);
	expect(html).not.toMatch(/%client\.[^%]+%/);
	expect(linkHeader).toMatch(
		/rel="modulepreload"[^,]+integrity="sha384-[A-Za-z0-9+/]{64}"[^,]+crossorigin="anonymous"/
	);
});

test('blocks interaction until the initial client assets have loaded', async ({ page }) => {
	await holdClientReady(page);
	await page.goto(pagePath, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('#cadbos-client-loading')).toBeVisible();
	await expect(page.locator('#cadbos-client-loading > #cadbos-client-load-pending')).toBeVisible();
	await expect(page.locator('#cadbos-client-load-ribbon')).toBeVisible();
	await expect(page.locator('#cadbos-client-load-pending')).toHaveText('');
	await expect(page.locator('#cadbos-client-load-pending')).toHaveCSS(
		'background-color',
		'rgba(0, 0, 0, 0)'
	);
	await expect(page.locator('#cadbos-client-load-pending')).toHaveCSS('box-shadow', 'none');
	await expect(page.locator('#cadbos-client-load-pending')).toHaveAccessibleName(
		ru['clientLoad.loading']
	);
	await expect(page.locator('#cadbos-client-load-status')).toHaveCount(0);
	await expect
		.poll(() =>
			page
				.locator('.cadbos-client-load-stroke')
				.first()
				.evaluate((path) => path.getAnimations().length)
		)
		.toBe(1);
	await expect(page.locator('#cadbos-client-load-error')).toBeHidden();
	await expect(page.locator('#cadbos-client-app')).toHaveAttribute('inert', '');

	await releaseClientReady(page);
	await expect(page.locator('#cadbos-client-loading')).toHaveCount(0);
	await expect(page.locator('#cadbos-client-app')).not.toHaveAttribute('inert', '');
});

test('shows a refresh action immediately when JavaScript integrity fails', async ({ page }) => {
	await page.route(javaScriptAsset, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/javascript',
			body: 'export {};'
		});
	});

	await page.goto(pagePath, { waitUntil: 'domcontentloaded' });
	const error = page.locator('#cadbos-client-load-error');
	const refresh = page.getByRole('link', { name: ru['clientLoad.refresh'] });

	await expect(error).toBeVisible({ timeout: 5_000 });
	await expect(error).toContainText(ru['clientLoad.failed']);
	await expect(refresh).toBeFocused();

	const reload = page.waitForRequest(
		(request) => request.isNavigationRequest() && request.url().endsWith(pagePath)
	);
	await refresh.click();
	await reload;
});

test('shows the integrity error when the initial stylesheet is corrupted', async ({ page }) => {
	await page.route(cssAsset, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/css',
			body: 'body { color: red; }'
		});
	});

	await page.goto(pagePath, { waitUntil: 'domcontentloaded' });
	const overlay = page.locator('#cadbos-client-loading');
	const errorState = page.locator('#cadbos-client-load-error-state');
	const error = page.locator('#cadbos-client-load-error');
	const refresh = page.getByRole('link', { name: ru['clientLoad.refresh'] });

	await expect(error).toBeVisible({ timeout: 5_000 });
	await expect(error).toContainText(ru['clientLoad.failed']);
	await expect(page.locator('#cadbos-client-app')).toHaveAttribute('inert', '');
	await expect(overlay).toHaveCSS('position', 'fixed');
	await expect(overlay).toHaveCSS('background-color', 'rgb(245, 245, 247)');
	await expect(errorState).toHaveCSS('background-color', 'rgb(255, 255, 255)');
	await expect(errorState).toHaveCSS('border-radius', '16px');
	await expect(errorState).not.toHaveCSS('box-shadow', 'none');
	await expect(error).toHaveCSS('display', 'grid');
	await expect(refresh).toHaveCSS('background-color', 'rgb(47, 111, 79)');
});

test('shows the failure fallback when the bootstrap script cannot run', async ({ page }) => {
	await page.route(`**${pagePath}`, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: {
				...response.headers(),
				'content-security-policy':
					"default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:"
			}
		});
	});

	await page.goto(pagePath, { waitUntil: 'domcontentloaded' });
	const error = page.locator('#cadbos-client-load-error');
	const refresh = page.getByRole('link', { name: ru['clientLoad.refresh'] });

	await expect(error).toBeVisible();
	await expect(error).toContainText(ru['clientLoad.failed']);
	await expect(refresh).toHaveAttribute('href', '');
	await expect(page.locator('#cadbos-client-app')).toHaveAttribute('inert', '');

	const reload = page.waitForRequest(
		(request) => request.isNavigationRequest() && request.url().endsWith(pagePath)
	);
	await refresh.click();
	await reload;
});

test('shows the integrity error after the loading watchdog expires', async ({ page }) => {
	await page.clock.install();
	await holdClientReady(page);
	await page.goto(pagePath, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('#cadbos-client-load-ribbon')).toBeVisible();

	await page.clock.runFor(30_001);
	await expect(page.locator('#cadbos-client-load-error')).toBeVisible();
});
