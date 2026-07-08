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

import { afterEach, describe, expect, it, vi } from 'vitest';

const archai = vi.hoisted(() => ({
	postRenderInterior: vi.fn(),
	postEditByPrompt: vi.fn(),
	postStyleTransfer: vi.fn(),
	postAutoPrompt: vi.fn()
}));
const appEnvironment = vi.hoisted(() => ({ dev: true }));

vi.mock('$lib/server/archai', () => archai);
vi.mock('$app/environment', () => ({
	get dev() {
		return appEnvironment.dev;
	}
}));

const { editInterior, generateAutoPrompt, renderInterior, styleTransferInterior } =
	await import('./generation');

const withoutKey = { env: {} } as App.Platform;
const publicUploadsUrl = 'https://uploads.cadbos.example';

function mockBucket(): { put: ReturnType<typeof vi.fn> } {
	return { put: vi.fn(async () => undefined) };
}

function withKey(bucket: ReturnType<typeof mockBucket> = mockBucket()): App.Platform {
	return {
		env: {
			ARCHAI_API_KEY: 'test-key',
			UPLOADS_BUCKET: bucket,
			UPLOADS_PUBLIC_URL: publicUploadsUrl
		}
	} as unknown as App.Platform;
}

function mockDownloadedImage(mime = 'image/webp'): ReturnType<typeof vi.fn> {
	const fetch = vi.fn(
		async () => new Response('generated-image-bytes', { headers: { 'content-type': mime } })
	);
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

function mockImageId(id: string): void {
	vi.spyOn(crypto, 'randomUUID').mockReturnValue(id as ReturnType<typeof crypto.randomUUID>);
}

afterEach(() => {
	appEnvironment.dev = true;
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('renderInterior', () => {
	it('falls back to the dev mock when no API key is configured', async () => {
		const result = await renderInterior(withoutKey, {
			image: 'https://example.test/room.jpg',
			prompt: 'cozy',
			outputFormat: 'webp'
		});
		expect(result.outputUrl).toMatch(/^https:\/\//);
	});

	it('normalizes an array output to its first element (И-MA-4)', async () => {
		const bucket = mockBucket();
		const fetch = mockDownloadedImage();
		mockImageId('123e4567-e89b-12d3-a456-426614174000');
		archai.postRenderInterior.mockResolvedValue({
			data: {
				output: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
				cost: 1,
				balance: 24
			}
		});

		const result = await renderInterior(withKey(bucket), {
			image: 'https://example.test/room.jpg',
			prompt: 'cozy',
			outputFormat: 'webp'
		});

		expect(fetch).toHaveBeenCalledWith(
			'https://example.test/a.jpg',
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		expect(bucket.put).toHaveBeenCalledWith(
			'123e4567-e89b-12d3-a456-426614174000.webp',
			expect.any(ArrayBuffer),
			{ httpMetadata: { contentType: 'image/webp' } }
		);
		expect(result).toEqual({
			outputUrl: `${publicUploadsUrl}/123e4567-e89b-12d3-a456-426614174000.webp`,
			cost: 1,
			balance: 24
		});
	});

	it('stores a string output URL and returns the bucket URL', async () => {
		const bucket = mockBucket();
		mockDownloadedImage('image/png');
		mockImageId('123e4567-e89b-12d3-a456-426614174001');
		archai.postRenderInterior.mockResolvedValue({
			data: { output: 'https://example.test/a.jpg', cost: 1, balance: 24 }
		});

		const result = await renderInterior(withKey(bucket), {
			image: 'https://example.test/room.jpg',
			prompt: '',
			outputFormat: 'webp'
		});

		expect(bucket.put).toHaveBeenCalledWith(
			'123e4567-e89b-12d3-a456-426614174001.png',
			expect.any(ArrayBuffer),
			{ httpMetadata: { contentType: 'image/png' } }
		);
		expect(result.outputUrl).toBe(`${publicUploadsUrl}/123e4567-e89b-12d3-a456-426614174001.png`);
	});

	it('throws a generic error without leaking provider details', async () => {
		archai.postRenderInterior.mockResolvedValue({
			error: { message: 'insufficient balance: account 9f3a' }
		});

		await expect(
			renderInterior(withKey(), {
				image: 'https://example.test/room.jpg',
				prompt: '',
				outputFormat: 'webp'
			})
		).rejects.toThrow('Render failed');
	});

	it('returns the charged provider result when downloading the mirror image fails', async () => {
		const providerUrl = 'https://example.test/a.jpg';
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network unavailable');
			})
		);
		archai.postRenderInterior.mockResolvedValue({
			data: { output: providerUrl, cost: 1, balance: 24 }
		});

		try {
			const result = await renderInterior(withKey(), {
				image: 'https://example.test/room.jpg',
				prompt: '',
				outputFormat: 'webp'
			});

			expect(result).toEqual({ outputUrl: providerUrl, cost: 1, balance: 24 });
			expect(consoleError).toHaveBeenCalledWith(
				'archAI render/interior image mirror failed after successful generation:',
				'download fetch failed (Error)'
			);
		} finally {
			consoleError.mockRestore();
		}
	});
});

describe('editInterior', () => {
	it('falls back to the dev mock when no API key is configured', async () => {
		const result = await editInterior(withoutKey, {
			image: 'https://example.test/prev-render.jpg',
			prompt: 'make the wall sage green'
		});
		expect(result.outputUrl).toMatch(/^https:\/\//);
	});

	it('normalizes the single-string output (И-MA-ED2)', async () => {
		const bucket = mockBucket();
		mockDownloadedImage();
		mockImageId('123e4567-e89b-12d3-a456-426614174002');
		archai.postEditByPrompt.mockResolvedValue({
			data: { output: 'https://example.test/edited.jpg', cost: 1, balance: 23 }
		});

		const result = await editInterior(withKey(bucket), {
			image: 'https://example.test/prev-render.jpg',
			prompt: 'make the wall sage green'
		});

		expect(bucket.put).toHaveBeenCalledWith(
			'123e4567-e89b-12d3-a456-426614174002.webp',
			expect.any(ArrayBuffer),
			{ httpMetadata: { contentType: 'image/webp' } }
		);
		expect(result).toEqual({
			outputUrl: `${publicUploadsUrl}/123e4567-e89b-12d3-a456-426614174002.webp`,
			cost: 1,
			balance: 23
		});
	});

	it('sends image/prompt with no outputFormat field (И-MA-ED1)', async () => {
		mockDownloadedImage();
		mockImageId('123e4567-e89b-12d3-a456-426614174003');
		archai.postEditByPrompt.mockResolvedValue({
			data: { output: 'https://example.test/edited.jpg', cost: 1, balance: 23 }
		});

		await editInterior(withKey(), {
			image: 'https://example.test/prev-render.jpg',
			prompt: 'replace the sofa with a leather armchair'
		});

		const call = archai.postEditByPrompt.mock.calls[0][0];
		expect(call.body).toEqual({
			image: 'https://example.test/prev-render.jpg',
			prompt: 'replace the sofa with a leather armchair'
		});
	});

	it('throws a generic error without leaking provider details', async () => {
		archai.postEditByPrompt.mockResolvedValue({
			error: { message: 'internal provider trace 9f3a' }
		});

		await expect(
			editInterior(withKey(), {
				image: 'https://example.test/prev-render.jpg',
				prompt: 'replace the sofa'
			})
		).rejects.toThrow('Edit failed');
	});

	it('throws when the response has no output URL', async () => {
		archai.postEditByPrompt.mockResolvedValue({
			data: { output: '', cost: 0, balance: 25 }
		});

		await expect(
			editInterior(withKey(), {
				image: 'https://example.test/prev-render.jpg',
				prompt: 'replace the sofa'
			})
		).rejects.toThrow('Edit failed');
	});

	it('returns the charged provider result when R2 upload fails', async () => {
		const providerUrl = 'https://example.test/edited.jpg';
		const bucket = {
			put: vi.fn(async () => {
				throw new Error('R2 unavailable');
			})
		};
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mockDownloadedImage();
		archai.postEditByPrompt.mockResolvedValue({
			data: { output: providerUrl, cost: 1, balance: 23 }
		});

		try {
			const result = await editInterior(withKey(bucket), {
				image: 'https://example.test/prev-render.jpg',
				prompt: 'replace the sofa'
			});

			expect(bucket.put).toHaveBeenCalled();
			expect(result).toEqual({ outputUrl: providerUrl, cost: 1, balance: 23 });
			expect(consoleError).toHaveBeenCalledWith(
				'archAI edit-by-prompt image mirror failed after successful generation:',
				'storage upload failed (Error)'
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it('returns the charged provider result when the mirror response is not an image', async () => {
		const providerUrl = 'https://example.test/edited.jpg';
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mockDownloadedImage('text/html');
		archai.postEditByPrompt.mockResolvedValue({
			data: { output: providerUrl, cost: 1, balance: 23 }
		});

		try {
			const result = await editInterior(withKey(), {
				image: 'https://example.test/prev-render.jpg',
				prompt: 'replace the sofa'
			});

			expect(result).toEqual({ outputUrl: providerUrl, cost: 1, balance: 23 });
			expect(consoleError).toHaveBeenCalledWith(
				'archAI edit-by-prompt image mirror failed after successful generation:',
				'unexpected content type text/html'
			);
		} finally {
			consoleError.mockRestore();
		}
	});
});

describe('styleTransferInterior', () => {
	it('falls back to the dev mock when no API key is configured', async () => {
		const result = await styleTransferInterior(withoutKey, {
			image: 'https://example.test/room.jpg',
			referenceImage: 'https://example.test/style.jpg',
			outputFormat: 'webp'
		});
		expect(result.outputUrl).toMatch(/^https:\/\//);
	});

	it('throws a generic production misconfiguration error without leaking API key details', async () => {
		appEnvironment.dev = false;
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			const transfer = styleTransferInterior(withoutKey, {
				image: 'https://example.test/room.jpg',
				referenceImage: 'https://example.test/style.jpg',
				outputFormat: 'webp'
			});

			await expect(transfer).rejects.toThrow(/^Style transfer failed$/);
			await expect(transfer).rejects.not.toThrow('ARCHAI_API_KEY not configured');
		} finally {
			consoleError.mockRestore();
		}
	});

	it('normalizes the first array output and stores the generated image', async () => {
		const bucket = mockBucket();
		mockDownloadedImage('image/png');
		mockImageId('123e4567-e89b-12d3-a456-426614174004');
		archai.postStyleTransfer.mockResolvedValue({
			data: {
				output: ['https://example.test/styled-a.jpg', 'https://example.test/styled-b.jpg'],
				cost: 2,
				balance: 22
			}
		});

		const result = await styleTransferInterior(withKey(bucket), {
			image: 'https://example.test/room.jpg',
			referenceImage: 'https://example.test/style.jpg',
			outputFormat: 'webp',
			prompt: 'preserve the layout',
			negativePrompt: 'no people',
			styleTransferStrength: 0
		});

		expect(archai.postStyleTransfer.mock.calls[0][0].body).toEqual({
			image: 'https://example.test/room.jpg',
			referenceImage: 'https://example.test/style.jpg',
			outputFormat: 'webp',
			prompt: 'preserve the layout',
			negativePrompt: 'no people',
			styleTransferStrength: 0
		});
		expect(bucket.put).toHaveBeenCalledWith(
			'123e4567-e89b-12d3-a456-426614174004.png',
			expect.any(ArrayBuffer),
			{ httpMetadata: { contentType: 'image/png' } }
		);
		expect(result).toEqual({
			outputUrl: `${publicUploadsUrl}/123e4567-e89b-12d3-a456-426614174004.png`,
			cost: 2,
			balance: 22
		});
	});

	it('throws a generic error without leaking provider details', async () => {
		archai.postStyleTransfer.mockResolvedValue({
			error: { message: 'internal provider trace 9f3a' }
		});

		await expect(
			styleTransferInterior(withKey(), {
				image: 'https://example.test/room.jpg',
				referenceImage: 'https://example.test/style.jpg',
				outputFormat: 'webp'
			})
		).rejects.toThrow('Style transfer failed');
	});

	it('throws when the response has no output URL', async () => {
		archai.postStyleTransfer.mockResolvedValue({
			data: { output: [], cost: 0, balance: 25 }
		});

		await expect(
			styleTransferInterior(withKey(), {
				image: 'https://example.test/room.jpg',
				referenceImage: 'https://example.test/style.jpg',
				outputFormat: 'webp'
			})
		).rejects.toThrow('Style transfer failed');
	});
});

describe('generateAutoPrompt', () => {
	it('falls back to the dev mock when no API key is configured', async () => {
		const result = await generateAutoPrompt(withoutKey, {
			image: 'https://example.test/room.jpg'
		});
		expect(result.prompt).toContain('Scandinavian');
	});

	it('sends only the image and maps output text to prompt', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		archai.postAutoPrompt.mockResolvedValue({
			data: {
				output: 'cozy living room, oak floors, linen sofa',
				cost: 0.5,
				balance: 22.5
			}
		});

		const result = await generateAutoPrompt(withKey(), {
			image: 'https://example.test/room.jpg'
		});

		const call = archai.postAutoPrompt.mock.calls[0][0];
		expect(call.body).toEqual({ image: 'https://example.test/room.jpg' });
		expect(fetch).not.toHaveBeenCalled();
		expect(result).toEqual({
			prompt: 'cozy living room, oak floors, linen sofa',
			cost: 0.5,
			balance: 22.5
		});
	});

	it('throws a generic error without leaking provider details', async () => {
		archai.postAutoPrompt.mockResolvedValue({
			error: { message: 'provider request id 9f3a' }
		});

		await expect(
			generateAutoPrompt(withKey(), {
				image: 'https://example.test/room.jpg'
			})
		).rejects.toThrow('Auto-prompt failed');
	});

	it('throws when the response has no prompt text', async () => {
		archai.postAutoPrompt.mockResolvedValue({
			data: { output: '   ', cost: 0, balance: 25 }
		});

		await expect(
			generateAutoPrompt(withKey(), {
				image: 'https://example.test/room.jpg'
			})
		).rejects.toThrow('Auto-prompt failed');
	});
});
