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
import type { D1Database } from '@cloudflare/workers-types';
import { getPlatformProxy } from 'wrangler';
import { mockEdit, mockRender, mockUpscale } from '../src/lib/server/mocks/fixtures';

test('render, edit, and upscale chain through durable local billing', async ({ page, context }) => {
	await context.addCookies([
		{
			name: 'cadbos_session',
			value: 'paid-flow-session',
			domain: '127.0.0.1',
			path: '/',
			httpOnly: true,
			sameSite: 'Lax'
		}
	]);
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: 'https://cdn.example.test/uploaded.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	const sessionResponsePromise = page.waitForResponse((response) =>
		response.url().endsWith('/auth/me')
	);
	await page.goto('/create/interior?view=chat&format=webp');
	const sessionResponse = await sessionResponsePromise;
	expect(sessionResponse.status()).toBe(200);
	await expect(sessionResponse.json()).resolves.toMatchObject({
		user: { pubkey: 'a'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' },
		credit: { balance: 20 }
	});
	await page
		.locator('#mode-panel-render input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('room') });
	await page.getByRole('textbox', { name: 'Промпт чата' }).fill('warm oak and soft daylight');

	const renderResponsePromise = page.waitForResponse(
		(response) => response.url().endsWith('/api/render') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Сгенерировать' }).click();
	const renderResponse = await renderResponsePromise;
	expect(renderResponse.status()).toBe(200);
	expect(renderResponse.request().postDataJSON()).toEqual({
		image: 'https://cdn.example.test/uploaded.webp',
		prompt: 'warm oak and soft daylight',
		outputFormat: 'webp'
	});
	const render = mockRender();
	const resultImage = page.getByRole('img', { name: 'Сгенерировать' });
	await expect(resultImage).toHaveAttribute('src', render.outputUrl);
	await expect(page.getByText('Стоимость: 2')).toBeVisible();
	await expect(page.getByText('Баланс: 18')).toBeVisible();

	await page.getByRole('button', { name: 'Редактировать' }).click();
	await page.getByLabel('Инструкция для правки').fill('Replace the sofa with an armchair');
	const editResponsePromise = page.waitForResponse(
		(response) => response.url().endsWith('/api/edit') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Применить правку' }).click();
	const editResponse = await editResponsePromise;
	expect(editResponse.status()).toBe(200);
	expect(editResponse.request().postDataJSON()).toEqual({
		image: render.outputUrl,
		prompt: 'Replace the sofa with an armchair'
	});
	const edit = mockEdit();
	await expect(resultImage).toHaveAttribute('src', edit.outputUrl);
	const editPanel = page.locator('#mode-panel-edit');
	await expect(editPanel.getByText('Стоимость правки: 2.00', { exact: true })).toBeVisible();
	await expect(editPanel.getByText('Баланс: 16.00', { exact: true })).toBeVisible();

	const upscaleResponsePromise = page.waitForResponse(
		(response) => response.url().endsWith('/api/upscale') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Улучшить до 4K' }).click();
	const upscaleResponse = await upscaleResponsePromise;
	expect(upscaleResponse.status()).toBe(200);
	expect(upscaleResponse.request().postDataJSON()).toEqual({
		image: edit.outputUrl,
		outputFormat: 'webp'
	});
	const upscale = mockUpscale();
	await expect(resultImage).toHaveAttribute('src', upscale.outputUrl);
	await expect(editPanel.getByText('Стоимость правки: 3.00', { exact: true })).toBeVisible();
	await expect(editPanel.getByText('Баланс: 13.00', { exact: true })).toBeVisible();

	const platform = await getPlatformProxy<{ DB: D1Database }>({
		configPath: './wrangler.jsonc',
		persist: { path: '/tmp/cadbos-paid-flow-d1/v3' },
		remoteBindings: false
	});
	try {
		const generations = await platform.env.DB.prepare(
			'SELECT generation.prompt, generation.kind, detail.input_url, detail.output_url ' +
				'FROM generations generation JOIN image_generation_details detail ' +
				'ON detail.generation_id = generation.id ORDER BY generation.created_at, generation.rowid'
		).all<{ prompt: string; kind: string; input_url: string; output_url: string }>();
		expect(generations.results).toEqual([
			{
				prompt: 'warm oak and soft daylight',
				kind: 'render',
				input_url: 'https://cdn.example.test/uploaded.webp',
				output_url: render.outputUrl
			},
			{
				prompt: 'Replace the sofa with an armchair',
				kind: 'edit',
				input_url: render.outputUrl,
				output_url: edit.outputUrl
			},
			{
				prompt: '4k upscale',
				kind: 'upscale',
				input_url: edit.outputUrl,
				output_url: upscale.outputUrl
			}
		]);
		await expect(
			platform.env.DB.prepare(
				"SELECT COUNT(*) AS count FROM generation_operations WHERE status = 'completed'"
			).first<{ count: number }>()
		).resolves.toEqual({ count: 3 });
		await expect(
			platform.env.DB.prepare(
				'SELECT balance.balance FROM ledger_accounts account ' +
					'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
					"WHERE account.asset = 'app_credit' AND account.user_id = 'paid-flow-user'"
			).first<{ balance: number }>()
		).resolves.toEqual({ balance: 1300 });
		await expect(
			platform.env.DB.prepare(
				'SELECT balance.balance FROM ledger_accounts account ' +
					'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
					"WHERE account.asset = 'archai_token' AND account.user_id IS NULL"
			).first<{ balance: number }>()
		).resolves.toEqual({ balance: -700 });
	} finally {
		await platform.dispose();
	}
});
