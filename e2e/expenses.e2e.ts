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
import { mockFeaturebase } from './featurebase';
import { media } from './helpers/media';

const PK = '0'.repeat(64);
const PROJECT_ID = '00000000-0000-4000-8000-000000000700';
const SESSION_ID = '00000000-0000-4000-8000-000000000701';
const GENERATION_ID = '00000000-0000-4000-8000-000000000702';
const COMFY_GENERATION_ID = '00000000-0000-4000-8000-000000000704';
const LEDGER_ID = '101';
const COMFY_LEDGER_ID = '102';
const BEFORE_URL = '/api/media/test-media/before.webp';
const AFTER_URL = '/api/media/test-media/after.webp';

async function authenticateWithExpenseHistory(
	page: Page,
	queueWaitSec = 0,
	amount = 1.5
): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: PK, firstName: 'Ada', lastName: 'Lovelace' },
				featurebaseJwt: null,
				credit: {
					balance: 8.5,
					updatedAt: Date.now(),
					history: [
						{
							id: LEDGER_ID,
							generationId: GENERATION_ID,
							amount,
							balanceAfter: 8.5,
							kind: 'render',
							createdAt: Date.UTC(2026, 0, 1),
							comfyuiUploadQueueSec: 0,
							comfyuiQueueWaitSec: queueWaitSec,
							comfyuiExecutionSec: 0,
							comfyuiDownloadSec: 0,
							comfyuiReuploadSec: 0,
							archaiRenderSec: 10,
							archaiDownloadSec: 1,
							archaiReuploadSec: 1,
							sessionId: SESSION_ID,
							projectId: PROJECT_ID
						},
						{
							id: COMFY_LEDGER_ID,
							generationId: COMFY_GENERATION_ID,
							amount: 1.5,
							balanceAfter: 7,
							kind: 'render',
							createdAt: Date.UTC(2026, 0, 2),
							comfyuiUploadQueueSec: 3,
							comfyuiQueueWaitSec: 5,
							comfyuiExecutionSec: 10,
							comfyuiDownloadSec: 2,
							comfyuiReuploadSec: 1,
							archaiRenderSec: 0,
							archaiDownloadSec: 0,
							archaiReuploadSec: 0,
							sessionId: null,
							projectId: null
						}
					]
				}
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
}

async function mockGenerationDetail(page: Page, amount = 1.5): Promise<void> {
	await page.route(`**/api/generated-images/${GENERATION_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: GENERATION_ID,
				prompt: '',
				kind: 'render',
				createdAt: Date.UTC(2026, 0, 1),
				amount,
				balanceAfter: 8.5,
				image: media(2, AFTER_URL),
				source: media(1, BEFORE_URL),
				formSnapshot: null,
				session: {
					projectId: PROJECT_ID,
					projectTitle: 'Living room',
					sessionId: SESSION_ID,
					sessionTitle: 'Main thread'
				},
				media: [media(2, AFTER_URL), media(1, BEFORE_URL)]
			})
		});
	});
}

test('shows a free generation with an unchanged balance and restores its result', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page, 0, 0);
	await mockGenerationDetail(page, 0);
	await page.goto('/expenses');

	const entry = page.locator('button.history-entry');
	await expect(entry.locator('.value-cell')).toHaveText('0.00 $');
	await page.locator('.auth-trigger').click();
	await expect(page.locator('.balance-link')).toContainText('8.50 $');
	await page.locator('.auth-trigger').click();
	await entry.click();

	await expect(page).toHaveURL(new RegExp(`generation=${GENERATION_ID}`));
	const compareButton = page.getByRole('button', { name: 'Сравнить до/после' });
	await expect(compareButton).toBeEnabled();
	await compareButton.click();
	await expect(page.getByAltText('После', { exact: true })).toHaveAttribute('src', AFTER_URL);
	await expect(page.getByAltText('До', { exact: true })).toHaveAttribute('src', BEFORE_URL);
});

test('opens a beta balance top-up request from the expenses page', async ({ page }) => {
	await mockFeaturebase(page);
	await page.goto('/expenses');
	await expect(page.getByRole('button', { name: ru['auth.credit.requestTopUp'] })).toHaveCount(0);

	await authenticateWithExpenseHistory(page);
	await page.reload();
	await page.getByRole('button', { name: ru['auth.credit.requestTopUp'] }).click();

	await expect
		.poll(() =>
			page.evaluate(() => {
				const calls = (window as Window & { __featurebaseCalls?: [string, string?][] })
					.__featurebaseCalls;
				return calls?.find(([action]) => action === 'showNewMessage')?.[1] ?? null;
			})
		)
		.toBe(ru['auth.credit.requestTopUpDraft']);
});

test('groups generation durations and describes each duration column', async ({ page }) => {
	await authenticateWithExpenseHistory(page);
	await page.goto('/expenses');

	const rows = page.locator('.history-entry');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0).locator('.duration-values .cell')).toHaveText(['—', '10 с', '2 с']);
	await expect(rows.nth(1).locator('.duration-values .cell')).toHaveText(['8 с', '10 с', '3 с']);

	const uploadHint = page.getByRole('button', {
		name: ru['expenses.column.duration.upload']
	});
	await uploadHint.hover();
	await expect(page.locator('.hint-bubble')).toHaveText(ru['expenses.column.duration.upload']);

	const processingHint = page.getByRole('button', {
		name: ru['expenses.column.duration.processing']
	});
	await processingHint.hover();
	await expect(page.locator('.hint-bubble')).toHaveText(ru['expenses.column.duration.processing']);

	const downloadHint = page.getByRole('button', {
		name: ru['expenses.column.duration.download']
	});
	await downloadHint.hover();
	await expect(page.locator('.hint-bubble')).toHaveText(ru['expenses.column.duration.download']);
});

test('aligns duration header title with its icons and the other column titles', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page);
	await page.goto('/expenses');

	const alignment = await page.locator('.expenses-columns-header').evaluate((header) => {
		function textCenter(element: Element): { x: number; y: number } {
			const range = document.createRange();
			range.selectNodeContents(element);
			const rect = range.getBoundingClientRect();
			return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
		}

		const durationLabel = header.querySelector('.duration-group-label');
		const durationIcons = header.querySelector('.duration-icons');
		if (!durationLabel || !durationIcons) throw new Error('Duration header is incomplete');

		const iconsRect = durationIcons.getBoundingClientRect();
		return {
			durationTitle: textCenter(durationLabel),
			iconsCenterX: iconsRect.x + iconsRect.width / 2,
			otherTitles: [...header.querySelectorAll(':scope > span')].map(textCenter)
		};
	});

	expect(Math.abs(alignment.durationTitle.x - alignment.iconsCenterX)).toBeLessThanOrEqual(1);
	for (const title of alignment.otherTitles) {
		expect(Math.abs(title.y - alignment.durationTitle.y)).toBeLessThanOrEqual(1);
	}
	await expect(page.locator('.expenses-columns-header')).toHaveCSS('border-bottom-width', '0px');
});

test('keeps a long queue wait inside its duration column', async ({ page }) => {
	await authenticateWithExpenseHistory(page, 123_456);
	await page.goto('/expenses');

	const row = page.locator('.history-entry').first();
	await expect(row.locator('.duration-values .cell').first()).toHaveText('123456 с');

	const layout = await page.evaluate(() => {
		function centerX(element: Element): number {
			const rect = element.getBoundingClientRect();
			return rect.x + rect.width / 2;
		}

		const header = document.querySelector('.expenses-columns-header');
		const entry = document.querySelector('.history-entry');
		if (!header || !entry) throw new Error('Expenses row is missing');

		const icons = [...header.querySelectorAll('.hint-icon')];
		const values = [...entry.querySelectorAll('.duration-values .cell')];
		const headerValue = header.querySelector('.value-cell');
		const rowValue = entry.querySelector('.value-cell');
		const headerAction = header.querySelector(':scope > span:last-child');
		const rowAction = entry.querySelector(':scope > .cell:last-child');
		if (!headerValue || !rowValue || !headerAction || !rowAction) {
			throw new Error('Expenses columns are incomplete');
		}

		return {
			durationShift: icons.map((icon, index) => Math.abs(centerX(icon) - centerX(values[index]!))),
			valueShift: Math.abs(centerX(headerValue) - centerX(rowValue)),
			actionShift: Math.abs(centerX(headerAction) - centerX(rowAction))
		};
	});

	for (const shift of layout.durationShift) expect(shift).toBeLessThanOrEqual(1);
	expect(layout.valueShift).toBeLessThanOrEqual(1);
	expect(layout.actionShift).toBeLessThanOrEqual(1);
});

test('clicking an expense row opens its generation before/after in the workspace, anchored in the URL', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page);
	await mockGenerationDetail(page);
	await page.goto('/expenses');

	const detailRequest = page.waitForRequest(`**/api/generated-images/${GENERATION_ID}`);
	await page.locator('button.history-entry').click();
	await detailRequest;

	await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}`));
	await expect(page).toHaveURL(new RegExp(`session=${SESSION_ID}`));
	await expect(page).toHaveURL(new RegExp(`generation=${GENERATION_ID}`));

	const compareButton = page.getByRole('button', { name: 'Сравнить до/после' });
	await expect(compareButton).toBeEnabled();
	await compareButton.click();

	await expect(page.getByAltText('После', { exact: true })).toHaveAttribute('src', AFTER_URL);
	await expect(page.getByAltText('До', { exact: true })).toHaveAttribute('src', BEFORE_URL);

	// A genuinely new generation on top of the preview stays in the same
	// project/session, and the `generation=` anchor moves on to the new
	// result — what's on screen is now that one (see request.svelte.ts's
	// generationAnchor).
	await page.route('**/api/render', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: '00000000-0000-4000-8000-000000000703',
				output: media(3, '/api/media/test-media/new-render.webp'),
				cost: 1,
				balance: 7.5
			})
		});
	});
	await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/api/render') && response.ok()),
		page.getByRole('button', { name: 'Сгенерировать' }).click()
	]);

	await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}`));
	await expect(page).toHaveURL(new RegExp(`session=${SESSION_ID}`));
	await expect(page).toHaveURL(/generation=00000000-0000-4000-8000-000000000703/);
});

test('reloading a URL with a generation anchor reconstructs the same before/after view', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page);
	await mockGenerationDetail(page);

	await page.goto(
		`/create/interior?view=chat&format=webp&project=${PROJECT_ID}&session=${SESSION_ID}&generation=${GENERATION_ID}`
	);

	const compareButton = page.getByRole('button', { name: 'Сравнить до/после' });
	await expect(compareButton).toBeEnabled();
	await compareButton.click();

	await expect(page.getByAltText('После', { exact: true })).toHaveAttribute('src', AFTER_URL);
	await expect(page.getByAltText('До', { exact: true })).toHaveAttribute('src', BEFORE_URL);
});

test('surfaces an error and stays on the expenses page when the row’s generation is gone', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page);
	await page.route(`**/api/generated-images/${GENERATION_ID}`, async (route) => {
		await route.fulfill({
			status: 404,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'generation_not_found', message: 'Generation not found' }
			})
		});
	});
	await page.goto('/expenses');

	await page.locator('button.history-entry').click();

	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page).toHaveURL('/expenses');
});

test('retains deleted generation charges without an open action and shows a negative ledger balance', async ({
	page
}) => {
	await authenticateWithExpenseHistory(page);
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user: { pubkey: PK, firstName: 'Ada', lastName: 'Lovelace' },
				featurebaseJwt: null,
				credit: {
					balance: -1.5,
					updatedAt: Date.UTC(2026, 0, 1),
					history: [
						{
							id: LEDGER_ID,
							generationId: null,
							amount: 3.5,
							balanceAfter: -1.5,
							kind: null,
							createdAt: Date.UTC(2026, 0, 1),
							comfyuiUploadQueueSec: 0,
							comfyuiQueueWaitSec: 0,
							comfyuiExecutionSec: 0,
							comfyuiDownloadSec: 0,
							comfyuiReuploadSec: 0,
							archaiRenderSec: 0,
							archaiDownloadSec: 0,
							archaiReuploadSec: 0,
							sessionId: null,
							projectId: null
						}
					]
				}
			})
		});
	});
	await page.goto('/expenses');

	const entry = page.locator('.history-entry');
	await expect(entry).toHaveCount(1);
	await expect(entry).toContainText(ru['expenses.generationCharge']);
	await expect(entry.locator('.value-cell')).toHaveText('3.50 $');
	await expect(entry.locator('.duration-values .cell')).toHaveText(['—', '—', '—']);
	await expect(page.locator('button.history-entry')).toHaveCount(0);
	await page.locator('.auth-trigger').click();
	await expect(page.locator('.balance-link')).toContainText('-1.50 $');

	const languageSwitcher = page.getByRole('group', { name: ru['language.switcher.label'] });
	await languageSwitcher.getByRole('button', { name: 'ru' }).click();
	await languageSwitcher.getByRole('button', { name: ru['language.en'] }).click();
	await expect(entry).toContainText('Generation charge');
});
