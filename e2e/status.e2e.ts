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

import type { HealthSnapshot } from '$lib/api/contract';
import { expect, test } from './fixtures';

const FIRST_TIMESTAMP = '2026-08-12T10:00:00.000Z';
const SECOND_TIMESTAMP = '2026-08-12T10:00:02.000Z';

function snapshot(
	status: HealthSnapshot['status'],
	timestamp: string,
	r2Status: HealthSnapshot['status'] = status
): HealthSnapshot {
	return {
		status,
		timestamp,
		services: {
			archai: { status: 'healthy', latencyMs: 12 },
			assets: { status: 'healthy', latencyMs: 13 },
			comfyui: { status: 'healthy', latencyMs: 14 },
			d1: { status: 'healthy', latencyMs: 15 },
			nostr: { status: 'healthy', latencyMs: 16, reachable: 3, total: 4 },
			r2: { status: r2Status, latencyMs: 17 }
		}
	};
}

async function mockHealth(
	page: Page,
	response: { status: number; body?: unknown; cacheControl?: string }
): Promise<void> {
	await page.route('**/healthz', async (route) => {
		await route.fulfill({
			status: response.status,
			contentType: 'application/json',
			headers: response.cacheControl ? { 'cache-control': response.cacheControl } : undefined,
			body: response.body === undefined ? undefined : JSON.stringify(response.body)
		});
	});
}

test('shows the global service warning for a valid unhealthy snapshot', async ({ page }) => {
	await mockHealth(page, { status: 503, body: snapshot('unhealthy', FIRST_TIMESTAMP) });

	await page.goto('/version');

	const warning = page.getByRole('alert');
	const statusLink = warning.getByRole('link', { name: 'странице состояния' });
	await expect(warning).toHaveText(
		'Некоторые функции недоступны из-за сбоя сторонних сервисов. Подробнее на странице состояния'
	);
	await expect(warning).toHaveCSS('background-color', 'rgb(255, 203, 86)');
	await expect(statusLink).toHaveAttribute('href', '/status');
	await expect(statusLink).toHaveAttribute('target', '_blank');
	await expect(statusLink).toHaveAttribute('rel', 'noopener noreferrer');
	const icon = statusLink.locator('svg.lucide-arrow-up-right');
	await expect(icon).toHaveAttribute('width', '16');
	await expect(icon).toHaveAttribute('height', '16');
	await expect(icon).toHaveAttribute('stroke-width', '1.8');
});

test('does not show the global warning for healthy, failed, or invalid health checks', async ({
	page
}) => {
	for (const response of [
		{ status: 200, body: snapshot('healthy', FIRST_TIMESTAMP) },
		{ status: 502 },
		{ status: 200, body: { status: 'healthy' } }
	]) {
		await mockHealth(page, response);
		const healthResponse = page.waitForResponse('**/healthz');
		await page.goto('/version');
		await healthResponse;
		await expect(page.getByRole('link', { name: 'странице состояния' })).toHaveCount(0);
	}
});

test('checks health once across client-side navigation', async ({ page }) => {
	let requests = 0;
	await page.route('**/healthz', async (route) => {
		requests += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(snapshot('healthy', FIRST_TIMESTAMP))
		});
	});

	await page.goto('/');
	await expect.poll(() => requests).toBe(1);
	await page.getByRole('tab', { name: 'Экстерьер' }).click();
	await expect(page).toHaveURL(/\/create\/exterior/);
	await expect.poll(() => requests).toBe(1);
});

test('presents the initial status load as a separate loader region', async ({ page }) => {
	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	let requests = 0;
	await page.route('**/healthz', async (route) => {
		requests += 1;
		await responseGate;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(snapshot('healthy', FIRST_TIMESTAMP))
		});
	});

	await page.goto('/status');
	await expect.poll(() => requests).toBe(1);

	const loader = page.getByRole('status');
	await expect(loader).toHaveText('Загрузка состояния сервисов…');
	await expect(loader).toHaveCSS('display', 'grid');
	await expect(loader).toHaveCSS('align-items', 'center');
	await expect(loader).toHaveCSS('justify-items', 'center');
	await expect(loader).toHaveCSS('text-align', 'center');
	expect(
		await loader.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop))
	).toBeGreaterThanOrEqual(64);
	await expect(
		page.getByRole('table', { name: 'Состояние сервисов, используемых Cadbos' })
	).toHaveCount(0);

	releaseResponse?.();

	await expect(loader).toHaveCount(0);
	await expect(
		page.getByRole('table', { name: 'Состояние сервисов, используемых Cadbos' })
	).toBeVisible();
});

test('deduplicates the direct status load and preserves cache-driven polling', async ({ page }) => {
	await page.clock.install({ time: new Date(FIRST_TIMESTAMP) });
	let requests = 0;
	await page.route('**/healthz', async (route) => {
		requests += 1;
		const body =
			requests === 1
				? snapshot('healthy', FIRST_TIMESTAMP, 'healthy')
				: snapshot('unhealthy', SECOND_TIMESTAMP, 'unhealthy');
		await route.fulfill({
			status: body.status === 'healthy' ? 200 : 503,
			contentType: 'application/json',
			headers: { 'cache-control': 'public, max-age=60' },
			body: JSON.stringify(body)
		});
	});

	const response = await page.goto('/status');

	expect(response?.status()).toBe(200);
	await expect(page).toHaveTitle('Состояние сервисов');
	await expect(page.getByRole('heading', { name: 'Состояние сервисов' })).toBeVisible();
	await expect(
		page.getByRole('table', { name: 'Состояние сервисов, используемых Cadbos' })
	).toBeVisible();
	await expect(page.getByRole('row', { name: /archAI Работает 12 мс/ })).toBeVisible();
	await expect(
		page.getByRole('row', {
			name: /Ретрансляторы Nostr Работает 16 мс Доступно ретрансляторов: 3 из 4/
		})
	).toBeVisible();
	await expect(page.getByRole('row', { name: /Хранилище R2 Работает 17 мс/ })).toBeVisible();
	await expect.poll(() => requests).toBe(1);

	await page.clock.fastForward(59_999);
	expect(requests).toBe(1);
	await page.clock.fastForward(1);

	await expect.poll(() => requests).toBe(2);
	await expect(page.getByRole('row', { name: /Хранилище R2 Не работает 17 мс/ })).toBeVisible();
	await expect(page.getByRole('link', { name: 'странице состояния' })).toHaveCount(0);
	await expect(page.getByText('Проверено', { exact: false })).toBeVisible();
	await expect(page.getByRole('tab')).toHaveCount(0);
});

test('keeps the last snapshot through a refresh failure and recovers', async ({ page }) => {
	await page.clock.install({ time: new Date(FIRST_TIMESTAMP) });
	let requests = 0;
	await page.route('**/healthz', async (route) => {
		requests += 1;
		if (requests === 2) {
			await route.fulfill({ status: 502 });
			return;
		}

		const latencyMs = requests === 1 ? 12 : 42;
		const body = snapshot('healthy', FIRST_TIMESTAMP, 'healthy');
		body.services.archai.latencyMs = latencyMs;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'cache-control': 'public, max-age=1' },
			body: JSON.stringify(body)
		});
	});

	await page.goto('/status');
	await expect(page.getByRole('row', { name: /archAI Работает 12 мс/ })).toBeVisible();
	await page.clock.fastForward(1_000);

	await expect(page.getByRole('alert')).toHaveText(
		'Не удалось обновить состояние. Показаны последние доступные данные.'
	);
	await expect(page.getByRole('row', { name: /archAI Работает 12 мс/ })).toBeVisible();

	await page.clock.fastForward(30_000);

	await expect.poll(() => requests).toBe(3);
	await expect(page.getByRole('row', { name: /archAI Работает 42 мс/ })).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shows an alert when the initial health request fails', async ({ page }) => {
	await page.route('**/healthz', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ status: 'healthy' })
		});
	});

	await page.goto('/status');

	await expect(page.getByRole('alert')).toHaveText('Не удалось загрузить состояние сервисов.');
});
