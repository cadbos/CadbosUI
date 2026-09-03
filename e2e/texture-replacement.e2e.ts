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

import type { Page, Route } from '@playwright/test';

import { expect, test } from './fixtures';
import { media } from './helpers/media';
import {
	E2E_PROJECT_ID,
	E2E_SESSION_ID,
	mockProjectSessionRoutes
} from './helpers/project-session-routes';

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface UploadCapture {
	maskPng(): Buffer | undefined;
}

function pngFromMultipart(body: Buffer | null): Buffer | undefined {
	if (!body) return undefined;
	const start = body.indexOf(PNG_SIGNATURE);
	if (start === -1) return undefined;
	let offset = start + PNG_SIGNATURE.length;
	while (offset + 12 <= body.length) {
		const chunkLength = body.readUInt32BE(offset);
		const chunkType = body.toString('ascii', offset + 4, offset + 8);
		offset += 12 + chunkLength;
		if (offset > body.length) return undefined;
		if (chunkType === 'IEND') return body.subarray(start, offset);
	}
	return undefined;
}

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
	await mockProjectSessionRoutes(page);
}

function textureUploadFixture(route: Route): { key: string; url: string; mime: string } {
	const body = route.request().postDataBuffer();
	if (body === null) throw new Error('Upload request body is missing');
	if (pngFromMultipart(body) !== undefined) {
		return {
			key: '3',
			url: 'https://cdn.example.test/texture-mask.png',
			mime: 'image/png'
		};
	}
	if (body.includes(Buffer.from('scene'))) {
		return { key: '1', url: 'https://cdn.example.test/scene.webp', mime: 'image/webp' };
	}
	if (body.includes(Buffer.from('fabric'))) {
		return {
			key: '2',
			url: 'https://cdn.example.test/reference-fabric.webp',
			mime: 'image/webp'
		};
	}
	throw new Error('Upload request body does not match the texture replacement fixtures');
}

async function uploadInputs(page: Page): Promise<UploadCapture> {
	let maskPng: Buffer | undefined;
	await page.route('https://cdn.example.test/scene.webp', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#d9d1c7"/></svg>'
		});
	});
	await page.route('**/api/uploads', async (route) => {
		const fixture = textureUploadFixture(route);
		if (fixture.mime === 'image/png') {
			expect(route.request().headers()['content-type']).toContain('multipart/form-data');
			maskPng = pngFromMultipart(route.request().postDataBuffer());
			expect(maskPng).toBeDefined();
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				image: media(fixture.key, fixture.url),
				mime: fixture.mime,
				size: 1024,
				dimensions: [800, 600]
			})
		});
	});

	// Mask mode being the only mode now means the "or upload a ready mask"
	// input (target="textureMask") is already in the DOM before any photo is
	// picked, alongside the scene and reference-texture inputs — so these are
	// targeted by their accessible name instead of a fragile nth() position.
	const sceneInput = page.locator('#mode-panel-edit input[type="file"][aria-label="Фото комнаты"]');
	const referenceInput = page.locator(
		'#mode-panel-edit input[type="file"][aria-label="Референс новой текстуры — обязательно"]'
	);
	// The room/main photo upload is deferred to submit time — just pick the
	// file locally; the actual /api/uploads call fires once the test later
	// submits the texture-replacement request (or enters masked mode). Picking
	// it also flips the request straight into masked mode (mask-based
	// replacement is the only mode), which immediately swaps the photo
	// dropzone for the mask editor's canvas — wait for that canvas instead of
	// the dropzone's "change photo" button, so validation has settled on the
	// picked file rather than racing a pending reactive update.
	await sceneInput.setInputFiles({
		name: 'scene.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('scene')
	});
	await expect(
		page.locator(
			'#mode-panel-edit canvas[aria-label="Область рисования маски поверх исходной сцены"]'
		)
	).toBeVisible();
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		referenceInput.setInputFiles({
			name: 'fabric.webp',
			mimeType: 'image/webp',
			buffer: Buffer.from('fabric')
		})
	]);
	return { maskPng: () => maskPng };
}

// Draws a small brush stroke on the mask canvas and saves it — the minimum
// needed to satisfy validation and unlock submission, for tests that don't
// otherwise care about the mask editor's UX (see the dedicated coverage of
// brush/eraser/cursor behavior below).
async function drawAndSaveMask(page: Page): Promise<void> {
	const maskEditor = page.locator('#mode-panel-edit .canvas-col');
	const canvas = maskEditor.locator(
		'canvas[aria-label="Область рисования маски поверх исходной сцены"]'
	);
	await expect(canvas).toBeVisible();
	await expect
		.poll(() =>
			canvas.evaluate((element) => (element instanceof HTMLCanvasElement ? element.width : 0))
		)
		.toBe(800);
	await canvas.scrollIntoViewIfNeeded();
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error('Mask canvas has no visible bounds');
	await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.55);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.55, {
		steps: 8
	});
	await page.mouse.up();
	await expect(maskEditor.getByText('Сохраните маску после рисования.')).toBeVisible();
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		maskEditor.getByRole('button', { name: 'Сохранить маску' }).click()
	]);
	await expect(maskEditor.getByText('Маска сохранена и готова к замене текстуры.')).toBeVisible();
}

test('draws a mask and applies the synchronous result without polling', async ({ page }) => {
	await authenticate(page);
	await page.goto('/edit?tool=texture-replacement');
	const uploads = await uploadInputs(page);

	const panel = page.locator('#edit-tool-panel-texture-replacement');
	// The mask editor draws directly on the canvas image (Workspace.svelte's
	// canvas-col), not inside this tool panel — only the reference/job status
	// live in the panel itself. Mask mode is the only mode, so the mask editor
	// is already showing — no toggle to flip.
	const maskEditor = page.locator('#mode-panel-edit .canvas-col');
	await expect(page).toHaveURL(/masked=1/);
	await expect(panel.getByLabel(/Укажите поверхность или материал/)).toHaveCount(0);
	const canvas = maskEditor.locator(
		'canvas[aria-label="Область рисования маски поверх исходной сцены"]'
	);
	await expect(canvas).toBeVisible();
	await expect
		.poll(() =>
			canvas.evaluate((element) => (element instanceof HTMLCanvasElement ? element.width : 0))
		)
		.toBe(800);
	await canvas.scrollIntoViewIfNeeded();
	const canvasBounds = await canvas.boundingBox();
	if (!canvasBounds) throw new Error('Mask canvas has no visible bounds');
	const brushCursor = maskEditor.locator('.brush-cursor');
	await page.mouse.move(0, 0);
	await expect(brushCursor).toBeHidden();
	const cursorX = canvasBounds.x + canvasBounds.width * 0.25;
	const cursorY = canvasBounds.y + canvasBounds.height * 0.55;
	await page.mouse.move(cursorX, cursorY);
	await expect(brushCursor).toBeVisible();
	await expect(brushCursor).toHaveCSS('pointer-events', 'none');
	let brushCursorBounds = await brushCursor.boundingBox();
	if (!brushCursorBounds) throw new Error('Brush cursor has no visible bounds');
	expect(brushCursorBounds.width).toBeCloseTo((48 * canvasBounds.width) / 800, 0);
	expect(brushCursorBounds.height).toBeCloseTo((48 * canvasBounds.height) / 600, 0);
	expect(brushCursorBounds.x + brushCursorBounds.width / 2).toBeCloseTo(cursorX, 0);
	expect(brushCursorBounds.y + brushCursorBounds.height / 2).toBeCloseTo(cursorY, 0);
	const brushSize = maskEditor.locator('.brush-size input[type="range"]');
	await brushSize.evaluate((element) => {
		if (!(element instanceof HTMLInputElement))
			throw new Error('Brush size control is unavailable');
		element.value = '160';
		element.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.mouse.move(cursorX, cursorY);
	brushCursorBounds = await brushCursor.boundingBox();
	if (!brushCursorBounds) throw new Error('Brush cursor has no visible bounds');
	expect(brushCursorBounds.width).toBeCloseTo((160 * canvasBounds.width) / 800, 0);
	expect(brushCursorBounds.height).toBeCloseTo((160 * canvasBounds.height) / 600, 0);
	await maskEditor.getByRole('button', { name: 'Ластик' }).click();
	await canvas.hover({ position: { x: canvasBounds.width * 0.25, y: canvasBounds.height * 0.55 } });
	await expect(brushCursor).toHaveClass(/eraser/);
	await page.mouse.move(0, 0);
	await expect(brushCursor).toBeHidden();
	await maskEditor.getByRole('button', { name: 'Кисть' }).click();
	await brushSize.evaluate((element) => {
		if (!(element instanceof HTMLInputElement))
			throw new Error('Brush size control is unavailable');
		element.value = '48';
		element.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await drawAndSaveMask(page);
	const maskPng = uploads.maskPng();
	if (!maskPng) throw new Error('The generated mask PNG was not captured');
	const decodedMask = await page.evaluate(async (base64) => {
		const binary = atob(base64);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas 2D context is unavailable');
		context.drawImage(bitmap, 0, 0);
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		let black = 0;
		let white = 0;
		let invalid = 0;
		for (let index = 0; index < pixels.length; index += 4) {
			const red = pixels[index];
			const green = pixels[index + 1];
			const blue = pixels[index + 2];
			const alpha = pixels[index + 3];
			if (red === 0 && green === 0 && blue === 0 && alpha === 255) black += 1;
			else if (red === 255 && green === 255 && blue === 255 && alpha === 255) white += 1;
			else invalid += 1;
		}
		bitmap.close();
		return { width: canvas.width, height: canvas.height, black, white, invalid };
	}, maskPng.toString('base64'));
	expect(decodedMask).toMatchObject({ width: 800, height: 600, invalid: 0 });
	expect(decodedMask.black).toBeGreaterThan(0);
	expect(decodedMask.white).toBeGreaterThan(0);

	let submittedBody: unknown;
	let pollCount = 0;
	await page.route('**/api/texture-replacement/*', async (route) => {
		pollCount += 1;
		await route.abort();
	});
	await page.route('**/api/texture-replacement', async (route) => {
		submittedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'completed',
				output: media(4, 'https://cdn.example.test/masked-result.webp'),
				cost: 1.5,
				balance: 18.5
			})
		});
	});

	await panel.getByRole('button', { name: 'Заменить текстуру' }).click();

	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/masked-result.webp'
	);
	await expect(panel.locator('.job-success')).toHaveText('Замена текстуры завершена.');
	expect(submittedBody).toEqual({
		imageKey: 'cadbos-uploads/1',
		referenceImageKey: 'cadbos-uploads/2',
		maskImageKey: 'cadbos-uploads/3',
		sessionId: E2E_SESSION_ID
	});
	expect(pollCount).toBe(0);

	await page.route('**/api/edit', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: '00000000-0000-4000-8000-000000000301',
				output: media(5, 'https://cdn.example.test/follow-up-edit.webp'),
				cost: 1,
				balance: 17.5
			})
		});
	});
	await page.getByRole('tab', { name: 'Свой промпт' }).click();
	await page.getByLabel('Инструкция для правки').fill('Сделать светлее');
	await page.getByRole('button', { name: 'Применить правку' }).click();
	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/follow-up-edit.webp'
	);

	await page.getByRole('tab', { name: /Замена текстуры/ }).click();
	await expect(
		panel.getByText('Выделите область для замены прямо на изображении выше.')
	).toBeVisible();
	await expect(panel.locator('.job-success')).toHaveCount(0);
	await expect(panel.getByRole('button', { name: 'Новая замена' })).toHaveCount(0);
});

test('does not navigate back after switching tools during submission', async ({ page }) => {
	await authenticate(page);
	await page.goto('/edit?tool=texture-replacement');
	await uploadInputs(page);
	await drawAndSaveMask(page);

	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	let postCount = 0;
	await page.route('**/api/texture-replacement', async (route) => {
		postCount += 1;
		await responseGate;
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	await page.route(`**/api/texture-replacement/${JOB_ID}`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'retry-after': '30' },
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});

	const panel = page.locator('#edit-tool-panel-texture-replacement');
	await panel.getByRole('button', { name: 'Заменить текстуру' }).click();
	await expect.poll(() => postCount).toBe(1);
	await page.getByRole('tab', { name: 'Свой промпт' }).focus();
	await page.keyboard.press('Enter');
	releaseResponse?.();

	// The submission above lazily provisioned a project/session (see
	// mockProjectSessionRoutes) — the tool switch carries that forward instead
	// of dropping it (see buildWorkspaceUrl in url-state.ts).
	await expect(page).toHaveURL(
		new RegExp(`/edit\\?tool=freeform&project=${E2E_PROJECT_ID}&session=${E2E_SESSION_ID}$`)
	);
	await expect(page).not.toHaveURL(/tool=texture-replacement/);
});
