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

import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { mockProjectSessionRoutes, E2E_SESSION_ID } from './helpers/project-session-routes';

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typeAndData));
	return Buffer.concat([length, typeAndData, crc]);
}

// A minimal, real, decodable solid-gray PNG at an exact pixel size — used
// where the app validates the file's declared MIME type against the
// supported list (jpeg/png/webp/avif; see normalizeImageContentType), which
// an SVG-typed fixture (see svg() below) would fail client-side.
function png(width: number, height: number): Buffer {
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdrData = Buffer.alloc(13);
	ihdrData.writeUInt32BE(width, 0);
	ihdrData.writeUInt32BE(height, 4);
	ihdrData.writeUInt8(8, 8); // bit depth
	ihdrData.writeUInt8(2, 9); // color type: RGB
	const scanline = Buffer.alloc((1 + width * 3) * height);
	for (let y = 0; y < height; y++) {
		const rowStart = y * (1 + width * 3);
		scanline[rowStart] = 0; // filter: none
		for (let x = 0; x < width; x++) {
			const pixelStart = rowStart + 1 + x * 3;
			scanline[pixelStart] = 136;
			scanline[pixelStart + 1] = 136;
			scanline[pixelStart + 2] = 136;
		}
	}
	return Buffer.concat([
		signature,
		pngChunk('IHDR', ihdrData),
		pngChunk('IDAT', deflateSync(scanline)),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';
// A real, decodable image is required — both the object overlay <img> (loaded
// from the mocked remote URL below) and the room photo's local blob: preview
// (see uploadScene) need to actually fire `onload` with real natural
// dimensions for ObjectAdderCanvas's default-rect placement to compute, same
// technique texture-replacement.e2e.ts uses for MaskEditor's canvas.
function svg(width: number, height: number, marker: string): string {
	return `<!--${marker}--><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#888"/></svg>`;
}

const SCENE_WIDTH = 800;
const SCENE_HEIGHT = 600;
const OBJECT_WIDTH = 300;
const OBJECT_HEIGHT = 150;
// x = 0.5 - width/2, y = 0.5 - height/2, width = 0.3,
// height = width * (objectH/objectW) * (sceneW/sceneH) = 0.3 * 0.5 * (800/600)
const DEFAULT_RECT = { x: 0.35, y: 0.4, width: 0.3, height: 0.2 };

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

// Sets up the room photo (picked but, per ImageUpload's 'room' target,
// deferred to submit time — see #ensureImageUploaded) and switches into the
// "by reference photo" sub-mode, returning once ObjectAdderCanvas has mounted.
async function enterReferenceMode(page: Page): Promise<void> {
	await page.route('**/api/uploads', async (route) => {
		const body = route.request().postDataBuffer();
		if (body === null) throw new Error('Upload request body is missing');
		const isScene = body.includes(Buffer.from('e2e-scene'));
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: isScene ? 'https://cdn.example.test/scene.svg' : 'https://cdn.example.test/object.svg',
				mime: 'image/svg+xml',
				size: 512,
				hash: isScene ? 'scene-hash' : 'object-hash',
				dimensions: isScene ? [SCENE_WIDTH, SCENE_HEIGHT] : [OBJECT_WIDTH, OBJECT_HEIGHT]
			})
		});
	});
	// Real, decodable bytes for both — see the module-level comment on svg().
	// The room photo's *locally picked file* doesn't need to decode (it's
	// only ever used as a deferred-upload source, never drawn before the
	// upload below resolves — see Workspace.svelte's eager-resolve effect for
	// showObjectAdderCanvas), so arbitrary bytes with an accepted mime type
	// are enough for it.
	await page.route('https://cdn.example.test/scene.svg', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: svg(SCENE_WIDTH, SCENE_HEIGHT, 'e2e-scene')
		});
	});
	await page.route('https://cdn.example.test/object.svg', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: svg(OBJECT_WIDTH, OBJECT_HEIGHT, 'e2e-object')
		});
	});

	await page.goto('/edit?tool=add-object');
	const roomInput = page.locator('#mode-panel-edit input[type="file"][aria-label="Фото комнаты"]');
	await roomInput.setInputFiles({
		name: 'scene.webp',
		mimeType: 'image/webp',
		buffer: Buffer.from('e2e-scene')
	});
	await expect(page.getByRole('button', { name: 'Изменить фото' })).toBeVisible();

	// Entering reference mode eagerly resolves the deferred room-photo
	// upload (see Workspace.svelte) — wait for it so the canvas below is
	// already showing the real (mocked) URL, not a transient local preview.
	await Promise.all([
		page.waitForResponse((response) => response.url().includes('/api/uploads') && response.ok()),
		page.getByRole('tab', { name: 'По референс-фото' }).click()
	]);
	const panel = page.locator('#edit-tool-panel-add-object-reference');
	await expect(panel).toBeVisible();
}

async function pickObject(page: Page): Promise<void> {
	const canvas = page.locator('.object-adder-canvas');
	await expect(canvas).toBeVisible();
	await canvas.getByLabel('Выбрать фото объекта').setInputFiles({
		name: 'object.svg',
		mimeType: 'image/svg+xml',
		buffer: Buffer.from('object-file-bytes')
	});
	// The default centered rect only appears once both the scene and object
	// <img> elements have fired `onload` with real natural dimensions.
	await expect(canvas.locator('.object-image')).toBeVisible();
}

test('places an object on the scene, drags/resizes it, and submits the composed request', async ({
	page
}) => {
	await authenticate(page);
	await enterReferenceMode(page);
	await pickObject(page);

	const wrapper = page.locator('.object-wrapper');

	let submittedBody: unknown;
	await page.route('**/api/object-adder', async (route) => {
		submittedBody = route.request().postDataJSON();
		await route.fulfill({
			status: 202,
			contentType: 'application/json',
			headers: { location: `/api/object-adder/${JOB_ID}` },
			body: JSON.stringify({ id: JOB_ID, status: 'processing' })
		});
	});
	let polls = 0;
	await page.route(`**/api/object-adder/${JOB_ID}`, async (route) => {
		polls += 1;
		if (polls === 1) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'retry-after': '0' },
				body: JSON.stringify({ id: JOB_ID, status: 'processing' })
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				id: JOB_ID,
				status: 'completed',
				outputUrl: 'https://cdn.example.test/added.webp',
				cost: 1.5,
				balance: 18.5
			})
		});
	});

	const panel = page.locator('#edit-tool-panel-add-object-reference');

	// Reads the rect the canvas is actually rendering (its CSS percentages),
	// rather than re-deriving an expected pixel delta from synthetic pointer
	// input — that's what pointer-precision e2e assertions should compare
	// against, since exactly how many intermediate pointermove events a
	// simulated drag produces isn't a contract worth pinning to a formula.
	async function readWrapperRectPercent(): Promise<{
		left: number;
		top: number;
		width: number;
		height: number;
	}> {
		return wrapper.evaluate((el) => ({
			left: parseFloat(el.style.left),
			top: parseFloat(el.style.top),
			width: parseFloat(el.style.width),
			height: parseFloat(el.style.height)
		}));
	}

	const beforeMove = await readWrapperRectPercent();
	expect(beforeMove.left).toBeCloseTo(DEFAULT_RECT.x * 100, 1);
	expect(beforeMove.top).toBeCloseTo(DEFAULT_RECT.y * 100, 1);
	expect(beforeMove.width).toBeCloseTo(DEFAULT_RECT.width * 100, 1);
	expect(beforeMove.height).toBeCloseTo(DEFAULT_RECT.height * 100, 1);

	// Drag the object down and to the right — exercises beginMove/continueMove.
	const wrapperBoxBeforeDrag = await wrapper.boundingBox();
	if (!wrapperBoxBeforeDrag) throw new Error('Object wrapper has no layout box');
	const dragStartX = wrapperBoxBeforeDrag.x + wrapperBoxBeforeDrag.width / 2;
	const dragStartY = wrapperBoxBeforeDrag.y + wrapperBoxBeforeDrag.height / 2;
	await page.mouse.move(dragStartX, dragStartY);
	await page.mouse.down();
	await page.mouse.move(dragStartX + 40, dragStartY + 20, { steps: 5 });
	await page.mouse.up();

	const afterMove = await readWrapperRectPercent();
	expect(afterMove.left).toBeGreaterThan(beforeMove.left);
	expect(afterMove.top).toBeGreaterThan(beforeMove.top);
	// Unchanged by a pure move.
	expect(afterMove.width).toBeCloseTo(beforeMove.width, 1);
	expect(afterMove.height).toBeCloseTo(beforeMove.height, 1);

	// Resize from the corner handle — exercises beginResize/continueResize.
	const wrapperBoxAfterDrag = await wrapper.boundingBox();
	if (!wrapperBoxAfterDrag) throw new Error('Object wrapper has no layout box');
	const handleX = wrapperBoxAfterDrag.x + wrapperBoxAfterDrag.width;
	const handleY = wrapperBoxAfterDrag.y + wrapperBoxAfterDrag.height;
	await page.mouse.move(handleX, handleY);
	await page.mouse.down();
	await page.mouse.move(handleX + 25, handleY + 10, { steps: 5 });
	await page.mouse.up();

	const afterResize = await readWrapperRectPercent();
	expect(afterResize.width).toBeGreaterThan(afterMove.width);
	expect(afterResize.height).toBeGreaterThan(afterMove.height);
	// Unchanged by a pure resize (anchored at the top-left corner).
	expect(afterResize.left).toBeCloseTo(afterMove.left, 1);
	expect(afterResize.top).toBeCloseTo(afterMove.top, 1);

	const expectedX = afterResize.left / 100;
	const expectedY = afterResize.top / 100;
	const expectedWidth = afterResize.width / 100;
	const expectedHeight = afterResize.height / 100;

	await panel
		.getByLabel('Дополнительные инструкции (необязательно)')
		.fill('подстроить освещение как слева');
	await panel.getByRole('button', { name: 'Добавить объект' }).click();

	await expect(page.locator('.result img.output')).toHaveAttribute(
		'src',
		'https://cdn.example.test/added.webp',
		{ timeout: 10_000 }
	);
	await expect(panel.locator('.job-success')).toHaveText('Объект добавлен.');
	await expect(page.getByText('Стоимость: 1.50')).toBeVisible();
	await expect(page.getByText('Баланс: 18.50')).toBeVisible();
	await expect.poll(() => polls).toBe(2);

	const body = submittedBody as {
		image: string;
		objectImage: string;
		rect: { x: number; y: number; width: number; height: number };
		prompt?: string;
		sessionId: string;
	};
	expect(body.image).toBe('https://cdn.example.test/scene.svg');
	expect(body.objectImage).toBe('https://cdn.example.test/object.svg');
	expect(body.prompt).toBe('подстроить освещение как слева');
	expect(body.sessionId).toBe(E2E_SESSION_ID);
	expect(body.rect.x).toBeCloseTo(expectedX, 2);
	expect(body.rect.y).toBeCloseTo(expectedY, 2);
	expect(body.rect.width).toBeCloseTo(expectedWidth, 2);
	expect(body.rect.height).toBeCloseTo(expectedHeight, 2);
});

test('surfaces a submission error and keeps the form usable for retry', async ({ page }) => {
	await authenticate(page);
	await enterReferenceMode(page);
	await pickObject(page);

	await page.route('**/api/object-adder', async (route) => {
		await route.fulfill({
			status: 402,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'insufficient_credit', message: 'Test balance exhausted' }
			})
		});
	});

	const panel = page.locator('#edit-tool-panel-add-object-reference');
	await panel.getByRole('button', { name: 'Добавить объект' }).click();
	await expect(panel.getByRole('alert')).toContainText('Тестовый баланс исчерпан');
	await expect(panel.getByRole('button', { name: 'Добавить объект' })).toBeEnabled();
});

test('lets the scene photo be changed from the canvas, resetting the placement', async ({
	page
}) => {
	await authenticate(page);
	await enterReferenceMode(page);
	await pickObject(page);

	const canvas = page.locator('.object-adder-canvas');
	// Native drag-and-drop on an <img> conflicts with the custom pointer-based
	// move/resize handlers (a real browser can require an extra press before a
	// drag "takes" while a stray dragstart is still settling) — both photos
	// must opt out.
	await expect(canvas.locator('.scene-image')).toHaveAttribute('draggable', 'false');
	await expect(canvas.locator('.object-image')).toHaveAttribute('draggable', 'false');

	const sceneSrcBefore = await canvas.locator('.scene-image').getAttribute('src');
	const topBefore = await canvas.locator('.object-wrapper').evaluate((el) => el.style.top);

	// Picking a new room photo here only ever creates a local preview (see
	// request.setPendingImage) — the actual upload is deferred to generate
	// time, same as the very first scene photo, so no /api/uploads mock is
	// needed to observe the swap. A different aspect ratio (2:1 vs the
	// original 4:3) makes the recomputed default placement measurably
	// different from the old one, proving the rect actually reset instead of
	// just being left alone.
	await canvas.getByLabel('Изменить фото сцены').setInputFiles({
		name: 'scene-2.png',
		mimeType: 'image/png',
		buffer: png(800, 400)
	});

	await expect
		.poll(() => canvas.locator('.scene-image').getAttribute('src'))
		.not.toBe(sceneSrcBefore);
	await expect(canvas.locator('.object-image')).toBeVisible();
	await expect
		.poll(() => canvas.locator('.object-wrapper').evaluate((el) => el.style.top))
		.not.toBe(topBefore);
});

test('requires authentication and a placed object before enabling submit', async ({ page }) => {
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 401,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'unauthorized', message: 'Authentication required' } })
		});
	});
	await page.goto('/edit?tool=add-object');
	await page.getByRole('tab', { name: 'По референс-фото' }).click();

	const panel = page.locator('#edit-tool-panel-add-object-reference');
	await expect(panel.getByText('Войдите, чтобы добавить объект')).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Добавить объект' })).toBeDisabled();
});
