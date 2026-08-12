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

import { expect, test } from '@playwright/test';
import type { HealthSnapshot } from '$lib/api/contract';

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

test('shows every health field and refreshes after the advertised cache lifetime', async ({
	page
}) => {
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
			headers: { 'cache-control': 'public, max-age=2' },
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

	await page.clock.fastForward(1_999);
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
