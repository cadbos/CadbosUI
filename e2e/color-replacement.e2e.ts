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

import { expect, test, type Page } from '@playwright/test';

const FIRST_JOB_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECOND_JOB_ID = '123e4567-e89b-42d3-a456-426614174001';

async function authenticate(page: Page): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' },
				credit: { balance: 20, updatedAt: 0, history: [] }
			})
		});
	});
	await page.route('**/auth/nostr-profile', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ profile: { relays: [] } })
		});
	});
	await page.route('**/api/generated-images**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ images: [], pagination: { offset: 0, size: 100, hasMore: false } })
		});
	});
}

test('uses the room photo first and the successful result for the next replacement', async ({
	page
}) => {
	await authenticate(page);
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: 'https://cdn.example.test/scene.webp',
				mime: 'image/webp',
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});
	const submittedBodies: unknown[] = [];
	await page.route('**/api/color-replacement', async (route) => {
		submittedBodies.push(route.request().postDataJSON());
		const id = submittedBodies.length === 1 ? FIRST_JOB_ID : SECOND_JOB_ID;
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id, status: 'processing' })
		});
	});
	await page.route(`**/api/color-replacement/${FIRST_JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: FIRST_JOB_ID,
				status: 'completed',
				outputUrl: 'https://cdn.example.test/recolored.webp',
				cost: 2,
				balance: 18
			})
		});
	});
	await page.route(`**/api/color-replacement/${SECOND_JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: SECOND_JOB_ID,
				status: 'completed',
				outputUrl: 'https://cdn.example.test/recolored-again.webp',
				cost: 2,
				balance: 16
			})
		});
	});

	await page.goto('/edit?tool=color-replacement');
	const roomPhotoStep = page.locator('section.step-card').filter({
		has: page.getByRole('heading', { name: 'Фото комнаты' })
	});
	const panel = page.locator('#edit-tool-panel-color-replacement');
	await expect(panel.locator('input[type="file"]')).toHaveCount(0);
	await roomPhotoStep.locator('input[type="file"]').setInputFiles({
		name: 'scene.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('scene')
	});
	await panel.getByLabel(/Укажите объект или поверхность/).fill('  обивка дивана  ');
	await panel.getByLabel(/Укажите желаемый цвет/).fill('  NCS S 3020-Y20R  ');
	await panel.getByRole('button', { name: 'Заменить цвет' }).click();

	await expect(page).toHaveURL(new RegExp(`tool=color-replacement.*job=${FIRST_JOB_ID}`));
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/recolored.webp'
	);
	await expect(panel.locator('.job-success')).toHaveText('Замена цвета завершена.');

	await panel.getByRole('button', { name: 'Новая замена' }).click();
	await expect(page).not.toHaveURL(/job=/);
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/recolored.webp'
	);
	await panel.getByLabel(/Укажите объект или поверхность/).fill('кресло');
	await panel.getByLabel(/Укажите желаемый цвет/).fill('RAL 9005');
	await panel.getByRole('button', { name: 'Заменить цвет' }).click();

	await expect(page).toHaveURL(new RegExp(`tool=color-replacement.*job=${SECOND_JOB_ID}`));
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/recolored-again.webp'
	);
	await expect(page.getByRole('button', { name: 'Отменить' })).toBeEnabled();
	expect(submittedBodies).toEqual([
		{
			image: 'https://cdn.example.test/scene.webp',
			targetObject: 'обивка дивана',
			color: 'NCS S 3020-Y20R'
		},
		{
			image: 'https://cdn.example.test/recolored.webp',
			targetObject: 'кресло',
			color: 'RAL 9005'
		}
	]);
});

test('keeps the selected tool state in a safe share URL', async ({ page }) => {
	await page.goto(
		'/edit?tool=color-replacement&source=current-result&target=sofa%20upholstery&color=%23AABBCC&image=https://evil.example.com/scene.jpg'
	);

	const tab = page.getByRole('tab', { name: /Замена цвета.*Альфа/ });
	await expect(tab).toHaveAttribute('aria-selected', 'true');
	await expect(tab.locator('svg')).toHaveCount(1);
	const panel = page.locator('#edit-tool-panel-color-replacement');
	await expect(panel.getByLabel(/Укажите объект или поверхность/)).toHaveValue('sofa upholstery');
	await expect(panel.getByPlaceholder('RGB, HEX, NCS или другое обозначение цвета')).toHaveValue(
		'#AABBCC'
	);
	await expect(page).not.toHaveURL(/image=/);
	await expect(page).not.toHaveURL(/source=/);
});
