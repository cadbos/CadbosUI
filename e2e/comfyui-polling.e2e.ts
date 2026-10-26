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

import { expect, test } from './fixtures';
import { ru } from '$lib/i18n/locales/ru';
import { media } from './helpers/media';
import { mockProjectSessionRoutes } from './helpers/project-session-routes';

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';
const instruments = [
	{ tool: 'repaint', route: 'repaint' },
	{ tool: 'freeform', route: 'edit' },
	{ tool: 'light-settings', route: 'light-settings' },
	{ tool: 'object-replacement', route: 'object-replacement' },
	{ tool: 'texture-replacement', route: 'texture-replacement' }
];

for (const instrument of instruments) {
	test(`${instrument.route} honors a sixty-second polling interval and displays completion`, async ({
		page
	}) => {
		await page.clock.install();
		await page.route('**/auth/me', async (route) => {
			await route.fulfill({
				json: {
					user: { pubkey: '0'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' },
					credit: { balance: 20, updatedAt: 0, history: [] }
				}
			});
		});
		await page.route('**/auth/nostr-profile', async (route) => {
			await route.fulfill({ json: { profile: { relays: [] } } });
		});
		await page.route('**/api/generated-images**', async (route) => {
			await route.fulfill({
				json: { images: [], pagination: { offset: 0, size: 100, hasMore: false } }
			});
		});
		await mockProjectSessionRoutes(page);
		await page.route('**/api/generation-estimates', async (route) => {
			await route.fulfill({
				json: { estimates: [{ kind: instrument.route, provider: 'comfyui', seconds: 60 }] }
			});
		});
		let polls = 0;
		await page.route(`**/api/${instrument.route}/${JOB_ID}`, async (route) => {
			polls += 1;
			if (polls === 1) {
				const now = await page.evaluate(() => Date.now());
				await page.clock.pauseAt(now + 100);
			}
			await route.fulfill(
				polls === 1
					? {
							headers: { 'retry-after': '60' },
							json: { id: JOB_ID, status: 'processing', elapsedMs: 30_000, queueAhead: 2 }
						}
					: {
							json: {
								id: JOB_ID,
								status: 'completed',
								output: media(3, '/api/media/test-media/completed.webp'),
								cost: 2,
								balance: 18
							}
						}
			);
		});
		await page.goto(`/edit?tool=${instrument.tool}&job=${JOB_ID}`);
		await expect.poll(() => polls).toBe(1);
		await expect(page.locator('.job-status:visible')).toBeVisible();
		const progress = page.getByRole('progressbar', { name: ru['generationOverlay.progressLabel'] });
		await expect(progress).toBeVisible();
		await expect(page.getByText('Перед вами в очереди: 2')).toBeVisible();
		await page.clock.runFor(1_000);
		await expect
			.poll(async () => Number(await progress.getAttribute('aria-valuenow')))
			.toBeGreaterThanOrEqual(50);
		await expect(page.getByText(/^Осталось примерно \d+\sс$/)).toBeVisible();
		const initialPercent = Number(await progress.getAttribute('aria-valuenow'));
		await page.clock.runFor(10_000);
		expect(polls).toBe(1);
		await expect
			.poll(async () => Number(await progress.getAttribute('aria-valuenow')))
			.toBeGreaterThan(initialPercent);
		await page.clock.runFor(48_000);
		expect(polls).toBe(1);
		await expect(progress).toHaveAttribute('aria-valuenow', '99');
		await page.clock.runFor(1_000);
		await expect.poll(() => polls).toBe(2);
		await expect(progress).toHaveAttribute('aria-valuenow', '100');
		await expect(page.getByText(ru['generationOverlay.done'], { exact: true })).toBeVisible();
		await expect(page.locator('.job-status:visible')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Скачать', exact: true })).toHaveAttribute(
			'href',
			'/api/media/test-media/3'
		);
		await page.clock.runFor(650);
		await expect(progress).toBeHidden();
	});
}
