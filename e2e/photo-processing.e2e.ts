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

import type { Locator, Page } from '@playwright/test';

import type { RequestFormSnapshot } from '$lib/api/contract';
import { ru } from '$lib/i18n/locales/ru';
import { expect, test } from './fixtures';
import { media, mediaKey } from './helpers/media';
import { E2E_SESSION_ID, mockProjectSessionRoutes } from './helpers/project-session-routes';

const SOURCE_FILENAME = 'photo-source.png';
const SOURCE_URL = `/api/media/test-media/${SOURCE_FILENAME}`;
const SAMPLE_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAACtElEQVR4nAXB+3PIBgDA8dz+kP3gh922O7ubm21cNo9lDPFOzSMo4lGNejSKNGjToCKlIlVCPeJRQpUorahHU894x2vGzXbcHudu293OnV/cd5+P8OHHIp/0Ffmin8igr0RGiiIlQ0RKh4mUjxKpGldQW1LgTS1onlkQaQVtZQVdFQW9lQVCn/4SfQdKfD1I4jtJYswIiSljJLSJEosnS5jTc9bNzmmcn7NLzzm8NOdUVU53dc71mhzho6Eynw+XEWWZ4eNlJkySmT5NZkGpTOVcmTULMzYuzgiMjL2rMuI1GWfqMi7XZ9xqyBA+HavQX1EYPEVh1AyFSXMUZi1Q0BcprFimYK9IabBSdtSmHFifcmJTyrnGlCtNKffCFOEzVWXALBVpnsrYcpWpS1TmLldZYqpUr1VZ7yRs3Ziwe3NC67aEZEfChZaEG1HCw9YEoV+ZxjcVGj9UakxcqTFjtUaZrWFs0FjrabhbY5q2x+zbFXNsX8zZQzE9cczt9pinHTHCl1U6Q6p15BqdH9fpzHZ1Fm3RWRno1O3U2bwnYueBiINHItrbItIk4mpnxP3uiOc9EcLAOoPv6w3GNRhM8w3mNRss3W1g7TfYcNjAPxbScjLkyJmQ02nIxUshN6+EPLoZ8vJuiPBto8WIJgsltJi512LhQYvlRy1qTlhsOm2xvctn/wWf45lP53Wf7LbPnQc+Pz3xefXcRxja4jA6cpjc6jDnuEPFKYdVZx2c8w5bLjuEV10O5S4n77mcf+Ry7ZnLg19cXrxy+eNPF2FY7DG+3UPt8Jh/zmPZRY/VvR71Nzy23fHYU9gcfWrT8cLm0m82+e82j9/Y/PqvzZu3NsLIzoCS7oDSnoDyawFVtwJq7wd4jwOafw6IXpq0vTbp+suk92+Tu/+ZPHtn8vq9yT8fmPwPKwf4MEOfoV4AAAAASUVORK5CYII=',
	'base64'
);

interface SavedSubmission {
	imageKey: string;
	sessionId: string;
	formSnapshot: RequestFormSnapshot;
	mime: string;
	bytes: Buffer;
	outputUrl: string;
	id: string;
}

function panel(page: Page): Locator {
	return page.locator('#mode-panel-edit');
}

function preview(page: Page): Locator {
	return panel(page).getByRole('img', { name: ru['photoProcessing.previewAlt'] });
}

async function selectPhotoTool(page: Page): Promise<void> {
	await page.getByRole('tab', { name: ru['mode.edit'], exact: true }).click();
	await panel(page).getByRole('tab', { name: ru['mode.photoProcessing'], exact: true }).click();
}

async function pixels(image: Locator): Promise<number[]> {
	await expect(image).toHaveJSProperty('naturalWidth', 16);
	await expect(image).toHaveJSProperty('complete', true);
	return image.evaluate((element: HTMLImageElement) => {
		const canvas = document.createElement('canvas');
		canvas.width = element.naturalWidth;
		canvas.height = element.naturalHeight;
		const context = canvas.getContext('2d');
		if (!context || !canvas.width || !canvas.height)
			throw new Error('Photo preview is not decoded');
		context.drawImage(element, 0, 0);
		return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
	});
}

async function mockPhotoWorkspace(page: Page, authenticated = true): Promise<void> {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: authenticated ? 200 : 401,
			contentType: 'application/json',
			body: JSON.stringify({
				user: authenticated
					? { pubkey: 'a'.repeat(64), firstName: 'Ada', lastName: 'Lovelace' }
					: null
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
	await page.route('**/api/media/**', async (route) => {
		await route.fulfill({ status: 200, contentType: 'image/png', body: SAMPLE_PNG });
	});
	await page.route('**/api/uploads', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				image: media(SOURCE_FILENAME, SOURCE_URL),
				mime: 'image/png',
				size: SAMPLE_PNG.length,
				dimensions: [16, 12]
			})
		});
	});
	await mockProjectSessionRoutes(page);
}

async function openPhoto(page: Page): Promise<void> {
	await page.goto('/edit?tool=photo-processing');
	await expect(page.getByRole('tab', { name: ru['mode.edit'], exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('tab', { name: ru['mode.photoProcessing'] })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await panel(page)
		.locator('input[type="file"]')
		.setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: SAMPLE_PNG });
	await expect(preview(page)).toBeVisible();
	await expect(preview(page)).toHaveJSProperty('naturalWidth', 16);
	await expect(panel(page).locator('.preview')).toHaveAttribute('aria-busy', 'false');
}

async function mockSaves(page: Page): Promise<SavedSubmission[]> {
	const submissions: SavedSubmission[] = [];
	await page.route('**/api/photo-processing', async (route) => {
		const body = route.request().postDataBuffer();
		if (!body) throw new Error('Missing processed photo request body');
		const data = await new Response(new Uint8Array(body), {
			headers: { 'content-type': route.request().headers()['content-type'] }
		}).formData();
		const file = data.get('file');
		if (!(file instanceof File)) throw new Error('Processed photo upload is missing');
		const id = `00000000-0000-4000-8000-${String(1520 + submissions.length).padStart(12, '0')}`;
		const outputFilename = `processed-${submissions.length}.png`;
		const outputUrl = `/api/media/test-media/${outputFilename}`;
		submissions.push({
			imageKey: String(data.get('imageKey')),
			sessionId: String(data.get('sessionId')),
			formSnapshot: JSON.parse(String(data.get('formSnapshot'))) as RequestFormSnapshot,
			mime: file.type,
			bytes: Buffer.from(await file.arrayBuffer()),
			outputUrl,
			id
		});
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id,
				output: media(outputFilename, outputUrl),
				cost: 0,
				balance: 0
			})
		});
	});
	return submissions;
}

const PROJECT_A = '00000000-0000-4000-8000-000000001541';
const PROJECT_B = '00000000-0000-4000-8000-000000001542';
const SESSION_A = '00000000-0000-4000-8000-000000001543';
const SESSION_B = '00000000-0000-4000-8000-000000001544';
const GENERATION_A = '00000000-0000-4000-8000-000000001545';
const GENERATION_B = '00000000-0000-4000-8000-000000001546';

async function openTwoProjects(page: Page): Promise<Locator> {
	const projects = [
		{
			id: PROJECT_A,
			sessionId: SESSION_A,
			generationId: GENERATION_A,
			title: 'Living room',
			filename: 'project-a.png'
		},
		{
			id: PROJECT_B,
			sessionId: SESSION_B,
			generationId: GENERATION_B,
			title: 'Kitchen',
			filename: 'project-b.png'
		}
	];
	await page.route('**/api/projects?**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				projects: projects.map(({ id, title }) => ({
					id,
					title,
					createdAt: 1,
					updatedAt: 1,
					sessionCount: 1,
					generationCount: 1
				})),
				pagination: { offset: 0, size: 20, hasMore: false }
			})
		});
	});
	for (const project of projects) {
		await page.route(`**/api/projects/${project.id}`, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: project.id,
					title: project.title,
					createdAt: 1,
					updatedAt: 1,
					shareActive: false,
					sessions: [
						{
							id: project.sessionId,
							title: 'Main thread',
							parentSessionId: null,
							forkedFromGenerationId: null,
							createdAt: 1,
							updatedAt: 1,
							generations: [
								{
									id: project.generationId,
									image: media(project.filename, `/api/media/test-media/${project.filename}`),
									source: media(SOURCE_FILENAME, SOURCE_URL),
									kind: 'render',
									createdAt: 1,
									amount: 0,
									balanceAfter: 0
								}
							]
						}
					]
				})
			});
		});
	}
	await page.goto(`/projects/${PROJECT_A}`);
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();
	await expect(page).toHaveURL(new RegExp(`session=${SESSION_A}`));
	await page.getByRole('link', { name: 'Проекты', exact: true }).click();
	await page.getByRole('link', { name: 'Открыть проект Kitchen', exact: false }).click();
	await page.getByRole('button', { name: 'Продолжить сессию «Main thread»' }).click();
	const tabs = page.getByRole('navigation', { name: 'Открытые проекты' });
	await tabs.getByRole('tab', { name: 'Living room', exact: true }).click();
	await selectPhotoTool(page);
	await expect(preview(page)).toBeVisible();
	return tabs;
}

test('photo mode previews actual pixel changes, compares the original and supports presets and keyboard tabs', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await mockPhotoWorkspace(page);
	let uploads = 0;
	page.on('request', (request) => {
		if (request.url().endsWith('/api/uploads')) uploads++;
	});
	await openPhoto(page);
	const original = await pixels(preview(page));
	const exposure = panel(page).getByRole('spinbutton', {
		name: ru['photoProcessing.adjustment.exposure']
	});
	await exposure.fill('50');
	await expect.poll(async () => (await pixels(preview(page)))[0]).toBeGreaterThan(original[0]);
	const changed = await pixels(preview(page));
	expect(changed).not.toEqual(original);
	expect(uploads).toBe(0);

	const compare = panel(page).getByRole('button', { name: ru['photoProcessing.showOriginal'] });
	await compare.click();
	await expect(compare).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => pixels(preview(page))).toEqual(original);
	await compare.click();
	await expect.poll(() => pixels(preview(page))).toEqual(changed);

	await panel(page).getByRole('button', { name: ru['photoProcessing.reset'] }).click();
	await expect(exposure).toHaveValue('0');
	await expect.poll(() => pixels(preview(page))).toEqual(original);
	const preset = panel(page).getByRole('button', { name: ru['photoProcessing.preset.warmDusk'] });
	await preset.click();
	await expect(preset).toHaveAttribute('aria-pressed', 'true');
	await expect(exposure).toHaveValue('-5');

	const lightTab = panel(page).getByRole('tab', {
		name: ru['photoProcessing.group.light'],
		exact: true
	});
	await lightTab.focus();
	await lightTab.press('ArrowRight');
	const colorTab = panel(page).getByRole('tab', {
		name: ru['photoProcessing.group.color'],
		exact: true
	});
	await expect(colorTab).toBeFocused();
	await expect(colorTab).toHaveAttribute('aria-selected', 'true');
	const temperature = panel(page).getByRole('spinbutton', {
		name: ru['photoProcessing.adjustment.temperature']
	});
	await expect(temperature).toHaveValue('28');
	await temperature.fill('-20');
	await expect(preset).toHaveAttribute('aria-pressed', 'false');
	await colorTab.press('End');
	const effectsTab = panel(page).getByRole('tab', {
		name: ru['photoProcessing.group.effects'],
		exact: true
	});
	await expect(effectsTab).toBeFocused();
	await expect(effectsTab).toHaveAttribute('aria-selected', 'true');
	await panel(page)
		.getByRole('spinbutton', { name: ru['photoProcessing.adjustment.grain'] })
		.fill('25');
	await expect.poll(() => panel(page).locator('.presets img[src^="blob:"]').count()).toBe(8);
	await expect(panel(page).locator('.preview')).toHaveAttribute('aria-busy', 'false');
	await panel(page)
		.locator('.panel-body')
		.evaluate((element) => element.scrollTo(0, 0));
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({
		path: testInfo.outputPath('photo-processing-desktop.png'),
		fullPage: true
	});

	await panel(page).getByRole('tab', { name: ru['edit.tool.repaint'], exact: true }).click();
	await expect(page).toHaveURL(/\/edit\?/);
	await selectPhotoTool(page);
	await expect(page).toHaveURL(/\/edit\?tool=photo-processing/);
	await panel(page)
		.getByRole('tab', { name: ru['photoProcessing.group.light'], exact: true })
		.click();
	await expect(exposure).toHaveValue('-5');
});

test('slider changes update continuously without hiding the previous preview', async ({ page }) => {
	await mockPhotoWorkspace(page);
	await openPhoto(page);
	const original = await pixels(preview(page));
	const slider = panel(page).getByRole('slider', {
		name: ru['photoProcessing.adjustment.exposure'],
		exact: true
	});
	const observed = await slider.evaluate(async (element: HTMLInputElement) => {
		const container = document.querySelector('#mode-panel-edit .preview');
		if (!container) throw new Error('Missing photo preview');
		const sources = new Set<string>();
		let hiddenFrames = 0;
		let skeletons = 0;
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (
						node instanceof Element &&
						(node.matches('.image-skeleton') || node.querySelector('.image-skeleton'))
					)
						skeletons++;
				}
			}
		});
		observer.observe(container, { childList: true, subtree: true });
		const start = performance.now();
		await new Promise<void>((resolve) => {
			function frame(now: number): void {
				const image = container?.querySelector('img');
				if (!image || !image.naturalWidth || getComputedStyle(image).opacity === '0')
					hiddenFrames++;
				if (image?.complete && image.naturalWidth) sources.add(image.currentSrc);
				element.value = String(10 + (Math.floor((now - start) / 25) % 60));
				element.dispatchEvent(new Event('input', { bubbles: true }));
				if (now - start < 1500) requestAnimationFrame(frame);
				else resolve();
			}
			requestAnimationFrame(frame);
		});
		observer.disconnect();
		return { updates: sources.size, hiddenFrames, skeletons };
	});
	expect(observed.updates).toBeGreaterThan(2);
	expect(observed.hiddenFrames).toBe(0);
	expect(observed.skeletons).toBe(0);
	await slider.fill('50');
	await expect(panel(page).locator('.preview')).toHaveAttribute('aria-busy', 'false');
	const finalPixels = await pixels(preview(page));
	expect(finalPixels).not.toEqual(original);
	await panel(page).getByRole('button', { name: ru['photoProcessing.reset'] }).click();
	await expect.poll(() => pixels(preview(page))).toEqual(original);
	await slider.fill('50');
	await expect(panel(page).locator('.preview')).toHaveAttribute('aria-busy', 'false');
	expect(await pixels(preview(page))).toEqual(finalPixels);
});

test('PNG save exports changed full-resolution pixels for free and undo/redo restores photo settings', async ({
	page
}) => {
	await mockPhotoWorkspace(page);
	const submissions = await mockSaves(page);
	await openPhoto(page);
	await panel(page).getByRole('combobox', { name: ru['render.outputFormat'] }).selectOption('png');
	const exposure = panel(page).getByRole('spinbutton', {
		name: ru['photoProcessing.adjustment.exposure']
	});
	await exposure.fill('20');
	const save = panel(page).getByRole('button', { name: ru['photoProcessing.save'], exact: true });
	await save.click();
	await expect.poll(() => submissions.length).toBe(1);
	await expect(save).toBeDisabled();
	const submitted = submissions[0];
	expect(submitted.imageKey).toBe(mediaKey(SOURCE_FILENAME));
	expect(submitted.sessionId).toBe(E2E_SESSION_ID);
	expect(submitted.mime).toBe('image/png');
	expect(submitted.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	expect(submitted.bytes.readUInt32BE(16)).toBe(16);
	expect(submitted.bytes.readUInt32BE(20)).toBe(12);
	expect(submitted.formSnapshot).toMatchObject({
		outputFormat: 'png',
		editOperationType: 'photo-processing',
		photoAdjustments: { exposure: 20, temperature: 0, grain: 0 }
	});
	const savedPixel = await page.evaluate(async (bytes) => {
		const bitmap = await createImageBitmap(
			new Blob([new Uint8Array(bytes)], { type: 'image/png' })
		);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas is unavailable');
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		return Array.from(context.getImageData(0, 0, 1, 1).data);
	}, Array.from(submitted.bytes));
	expect(savedPixel).toEqual([40, 53, 79, 255]);
	await expect(page).toHaveURL(new RegExp(`generation=${submitted.id}`));
	await expect(panel(page).getByRole('link', { name: ru['render.download'] })).toHaveAttribute(
		'href',
		submitted.outputUrl
	);

	await exposure.fill('40');
	await save.click();
	await expect.poll(() => submissions.length).toBe(2);
	await expect(save).toBeDisabled();
	await panel(page).getByRole('tab', { name: ru['edit.tool.repaint'], exact: true }).click();
	await page.getByRole('button', { name: ru['toolbar.previousGeneration'], exact: true }).click();
	await expect(
		page.getByRole('tab', { name: ru['mode.photoProcessing'], exact: true })
	).toHaveAttribute('aria-selected', 'true');
	await expect(exposure).toHaveValue('20');
	await expect(page).toHaveURL(new RegExp(`generation=${submissions[0].id}`));
	await panel(page)
		.getByRole('button', { name: ru['toolbar.nextGeneration'], exact: true })
		.click();
	await expect(exposure).toHaveValue('40');
	await expect(page).toHaveURL(new RegExp(`generation=${submissions[1].id}`));
});

test('4K accepts the uploaded original and both panel and toolbar block duplicate requests', async ({
	page
}) => {
	await mockPhotoWorkspace(page);
	let submitted: Record<string, unknown> | undefined;
	let calls = 0;
	let complete: (() => void) | undefined;
	const completion = new Promise<void>((resolve) => {
		complete = resolve;
	});
	await page.route('**/api/upscale', async (route) => {
		calls++;
		submitted = route.request().postDataJSON() as Record<string, unknown>;
		await completion;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: '00000000-0000-4000-8000-000000001529',
				output: media('upscaled.png', '/api/media/test-media/upscaled.png'),
				cost: 1,
				balance: 9
			})
		});
	});
	await openPhoto(page);
	const buttons = panel(page).getByRole('button', { name: ru['toolbar.upscale'], exact: true });
	await expect(buttons).toHaveCount(2);
	await buttons.nth(1).click();
	await expect.poll(() => calls).toBe(1);
	await expect(buttons.nth(0)).toBeDisabled();
	await expect(buttons.nth(1)).toBeDisabled();
	expect(submitted).toMatchObject({
		imageKey: mediaKey(SOURCE_FILENAME),
		sessionId: E2E_SESSION_ID
	});
	complete?.();
	await expect(buttons.nth(0)).toBeEnabled();
	await expect(page).toHaveURL(/generation=00000000-0000-4000-8000-000000001529/);
	expect(calls).toBe(1);
});

test('4K saves pending adjustments first and sends the saved photo to upscale', async ({
	page
}) => {
	await mockPhotoWorkspace(page);
	const saves = await mockSaves(page);
	let upscaleBody: Record<string, unknown> | undefined;
	await page.route('**/api/upscale', async (route) => {
		upscaleBody = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: '00000000-0000-4000-8000-000000001530',
				output: media('upscaled-edit.png', '/api/media/test-media/upscaled-edit.png'),
				cost: 1,
				balance: 9
			})
		});
	});
	await openPhoto(page);
	await panel(page)
		.getByRole('spinbutton', { name: ru['photoProcessing.adjustment.exposure'] })
		.fill('30');
	await panel(page)
		.getByRole('button', { name: ru['toolbar.upscale'], exact: true })
		.nth(1)
		.click();
	await expect(page).toHaveURL(/generation=00000000-0000-4000-8000-000000001530/);
	expect(saves).toHaveLength(1);
	expect(saves[0].formSnapshot.photoAdjustments?.exposure).toBe(30);
	expect(upscaleBody).toMatchObject({
		imageKey: mediaKey('processed-0.png'),
		sessionId: E2E_SESSION_ID,
		formSnapshot: { editOperationType: 'upscale', photoAdjustments: { exposure: 0 } }
	});
	await panel(page)
		.getByRole('button', { name: ru['toolbar.previousGeneration'], exact: true })
		.click();
	await expect(
		panel(page).getByRole('spinbutton', { name: ru['photoProcessing.adjustment.exposure'] })
	).toHaveValue('30');
	await expect(page).toHaveURL(new RegExp(`generation=${saves[0].id}`));
});

test('guests can preview adjustments but cannot save or upscale', async ({ page }) => {
	await mockPhotoWorkspace(page, false);
	await openPhoto(page);
	await panel(page)
		.getByRole('spinbutton', { name: ru['photoProcessing.adjustment.exposure'] })
		.fill('20');
	await expect(
		panel(page).getByRole('button', { name: ru['photoProcessing.save'], exact: true })
	).toBeDisabled();
	const upscales = panel(page).getByRole('button', { name: ru['toolbar.upscale'], exact: true });
	await expect(upscales.nth(0)).toBeDisabled();
	await expect(upscales.nth(1)).toBeDisabled();
	await expect(preview(page)).toHaveAttribute('src', /^blob:/);
});

test('a save failure keeps adjustments retryable and reports the server error', async ({
	page
}) => {
	await mockPhotoWorkspace(page);
	await page.route('**/api/photo-processing', async (route) => {
		await route.fulfill({
			status: 500,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'photo_processing_failed', message: 'Save failed' } })
		});
	});
	await openPhoto(page);
	const exposure = panel(page).getByRole('spinbutton', {
		name: ru['photoProcessing.adjustment.exposure']
	});
	await exposure.fill('20');
	const save = panel(page).getByRole('button', { name: ru['photoProcessing.save'], exact: true });
	await save.click();
	await expect(panel(page).getByRole('alert')).toHaveText(ru['photoProcessing.saveFailed']);
	await expect(exposure).toHaveValue('20');
	await expect(save).toBeEnabled();
	await expect(page).not.toHaveURL(/generation=/);
});

test('pending 4K attaches to its original project while a second project stays unchanged', async ({
	page
}) => {
	await mockPhotoWorkspace(page);
	const tabs = await openTwoProjects(page);
	let submitted: Record<string, unknown> | undefined;
	let release: (() => void) | undefined;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/api/upscale', async (route) => {
		submitted = route.request().postDataJSON() as Record<string, unknown>;
		await pending;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: '00000000-0000-4000-8000-000000001547',
				output: media('project-a-4k.png', '/api/media/test-media/project-a-4k.png'),
				cost: 1,
				balance: 9
			})
		});
	});
	await panel(page)
		.getByRole('button', { name: ru['toolbar.upscale'], exact: true })
		.nth(1)
		.click();
	await expect
		.poll(() => submitted)
		.toMatchObject({ imageKey: mediaKey('project-a.png'), sessionId: SESSION_A });
	await tabs.getByRole('tab', { name: 'Kitchen', exact: true }).press('Enter');
	await expect(tabs.getByRole('tab', { name: 'Kitchen', selected: true })).toBeVisible();
	release?.();
	await expect(page.getByText(ru['generationOverlay.upscale'], { exact: true })).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`session=${SESSION_B}&generation=${GENERATION_B}`));
	await expect(panel(page).getByRole('link', { name: ru['render.download'] })).toHaveAttribute(
		'href',
		'/api/media/test-media/project-b.png'
	);
	await panel(page).getByRole('button', { name: ru['photoProcessing.showOriginal'] }).click();
	await expect(preview(page)).toHaveAttribute('src', '/api/media/test-media/project-b.png');
	await tabs.getByRole('tab', { name: 'Living room', exact: true }).click();
	await expect(page).toHaveURL(/generation=00000000-0000-4000-8000-000000001547/);
	await expect(panel(page).getByRole('link', { name: ru['render.download'] })).toHaveAttribute(
		'href',
		'/api/media/test-media/project-a-4k.png'
	);
});

test('a paid 4K result without a history id stays downloadable after its original project is closed', async ({
	page
}) => {
	await mockPhotoWorkspace(page);
	const tabs = await openTwoProjects(page);
	let started = false;
	let release: (() => void) | undefined;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/api/upscale', async (route) => {
		started = true;
		await pending;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				output: media('completed-4k.png', '/api/media/test-media/completed-4k.png'),
				cost: 1,
				balance: 9
			})
		});
	});
	await panel(page)
		.getByRole('button', { name: ru['toolbar.upscale'], exact: true })
		.nth(1)
		.click();
	await expect.poll(() => started).toBe(true);
	await tabs.getByRole('button', { name: 'Закрыть вкладку «Living room»' }).press('Enter');
	await expect(tabs.getByRole('tab', { name: 'Living room', exact: true })).toHaveCount(0);
	release?.();
	await expect(page.getByText(ru['generationOverlay.upscale'], { exact: true })).toHaveCount(0);
	await selectPhotoTool(page);
	await expect(
		panel(page).getByRole('status').filter({ hasText: ru['photoProcessing.resultReady'] })
	).toBeVisible();
	await expect(
		panel(page).getByRole('link', { name: ru['photoProcessing.downloadResult'] })
	).toHaveAttribute('href', '/api/media/test-media/completed-4k.png');
	await expect(page).toHaveURL(new RegExp(`session=${SESSION_B}&generation=${GENERATION_B}`));
});

test('photo mode remains usable on mobile without horizontal overflow', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockPhotoWorkspace(page);
	await openPhoto(page);
	await panel(page).getByRole('button', { name: ru['photoProcessing.preset.brightRoom'] }).click();
	await expect(
		panel(page).getByRole('spinbutton', { name: ru['photoProcessing.adjustment.exposure'] })
	).toHaveValue('22');
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
		.toBeLessThanOrEqual(390);
	await expect.poll(() => panel(page).locator('.presets img[src^="blob:"]').count()).toBe(8);
	await expect(panel(page).locator('.preview')).toHaveAttribute('aria-busy', 'false');
	await panel(page)
		.locator('.panel-body')
		.evaluate((element) => element.scrollTo(0, 0));
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({
		path: testInfo.outputPath('photo-processing-mobile.png'),
		fullPage: true
	});
	await page.getByRole('tab', { name: ru['mode.render'], exact: true }).click();
	await expect(page).toHaveURL(/\/create\/interior/);
	await selectPhotoTool(page);
	await expect(page).toHaveURL(/\/edit\?tool=photo-processing/);
	await expect(
		panel(page).getByRole('spinbutton', { name: ru['photoProcessing.adjustment.exposure'] })
	).toHaveValue('22');
});

test('photo tool stays inside editing and its compact actions fit narrow and wide panels', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await mockPhotoWorkspace(page);
	await page.goto('/');
	const landing = page.getByRole('navigation', { name: ru['mode.switcher.label'] });
	await expect(landing.getByRole('button')).toHaveCount(3);
	await expect(landing.getByRole('button', { name: ru['mode.photoProcessing'] })).toHaveCount(0);
	await openPhoto(page);
	const modes = page.getByRole('tablist', { name: ru['mode.switcher.label'] });
	await expect(modes.getByRole('tab')).toHaveCount(3);
	await expect(modes.getByRole('tab', { name: ru['mode.edit'], exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(modes.getByRole('tab', { name: ru['mode.photoProcessing'] })).toHaveCount(0);
	await expect(panel(page).getByRole('tab', { name: ru['mode.photoProcessing'] })).toHaveAttribute(
		'aria-controls',
		'edit-tool-panel-photo-processing'
	);
	await expect(page.getByText('Без списания средств', { exact: true })).toHaveCount(0);
	await expect(
		page.getByText('Улучшение до 4K сохраняется отдельным шагом в истории.', { exact: true })
	).toHaveCount(0);
	const footer = panel(page).locator('.action-bar');
	const save = footer.getByRole('button', { name: ru['photoProcessing.save'], exact: true });
	const resize = panel(page).getByRole('slider', { name: ru['toolsPanel.resizeHandle'] });
	for (const size of ['Home', 'End']) {
		await resize.press(size);
		await footer.scrollIntoViewIfNeeded();
		await expect(save).toBeVisible();
		expect(
			await save.evaluate((element) => element.getBoundingClientRect().width)
		).toBeLessThanOrEqual(56);
		expect(await footer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
			true
		);
		const bounds = await footer.boundingBox();
		const buttons = await footer.locator('button').evaluateAll((elements) =>
			elements.map((element) => ({
				left: element.getBoundingClientRect().left,
				right: element.getBoundingClientRect().right
			}))
		);
		expect(bounds).not.toBeNull();
		for (const button of buttons) {
			expect(button.left).toBeGreaterThanOrEqual(bounds!.x - 1);
			expect(button.right).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
		}
		await page.screenshot({
			path: testInfo.outputPath(`photo-actions-${size}.png`),
			fullPage: true
		});
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await footer.scrollIntoViewIfNeeded();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.screenshot({ path: testInfo.outputPath('photo-actions-mobile.png'), fullPage: true });
});
