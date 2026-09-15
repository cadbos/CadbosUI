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
import type { Bucket } from '$lib/server/media';
import { TEST_S3_BUCKET, TEST_S3_ENV } from '$lib/server/testing/generation-fixtures';

const archai = vi.hoisted(() => ({
	postChangeTextures: vi.fn(),
	postRenderInterior: vi.fn(),
	postStyleTransfer: vi.fn()
}));
const appEnvironment = vi.hoisted(() => ({ dev: true }));
const storage = vi.hoisted(() => ({
	putS3Object:
		vi.fn<
			(
				platform: App.Platform | undefined,
				bucket: Bucket,
				key: string,
				bytes: ArrayBuffer,
				mime: string
			) => Promise<void>
		>()
}));

vi.mock('$lib/server/archai', () => archai);
vi.mock('$app/environment', () => ({
	get dev() {
		return appEnvironment.dev;
	}
}));
vi.mock('$lib/server/s3', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/s3')>()),
	putS3Object: storage.putS3Object
}));

const { renderInterior, replaceTexturesWithMask, styleTransferInterior } =
	await import('./generation');

const withoutKey = { env: {} } as App.Platform;
const archaiApiUrl = 'https://archai.example.test/v1';
const generatedImageHash = 'ea6ee3ad978493f9f7d995feff3384f7a08d46ec01510e0c07d21dc7c05ac37a';

function mockBucket(): { put: ReturnType<typeof vi.fn> } {
	return { put: vi.fn(async (_key: string, _bytes: ArrayBuffer, _metadata: unknown) => undefined) };
}

function withKey(bucket: ReturnType<typeof mockBucket> = mockBucket()): App.Platform {
	storage.putS3Object.mockImplementation(async (_platform, _bucket, key, bytes, mime) => {
		const put = bucket.put as unknown as (
			key: string,
			bytes: ArrayBuffer,
			metadata: { httpMetadata: { contentType: string } }
		) => Promise<void>;
		await put(key, bytes, { httpMetadata: { contentType: mime } });
	});
	return {
		env: {
			ARCHAI_API_KEY: 'test-key',
			ARCHAI_API_URL: archaiApiUrl,
			...TEST_S3_ENV
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
		const result = await renderInterior(withoutKey, TEST_S3_BUCKET, {
			image: 'https://example.test/room.jpg',
			prompt: 'cozy',
			outputFormat: 'webp'
		});
		expect(result.outputKey).toBeTruthy();
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

		const result = await renderInterior(withKey(bucket), TEST_S3_BUCKET, {
			image: 'https://example.test/room.jpg',
			prompt: 'cozy',
			outputFormat: 'webp'
		});

		expect(archai.postRenderInterior.mock.calls[0][0].client.getConfig().baseUrl).toBe(
			archaiApiUrl
		);
		expect(String(fetch.mock.calls[0]?.[0])).toBe('https://example.test/a.jpg');
		expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
		expect(fetch.mock.calls[0]?.[1]?.signal).toBeDefined();
		expect(bucket.put).toHaveBeenCalledWith(
			'123e4567-e89b-12d3-a456-426614174000.webp',
			expect.any(ArrayBuffer),
			{ httpMetadata: { contentType: 'image/webp' } }
		);
		expect(result).toEqual({
			outputKey: '123e4567-e89b-12d3-a456-426614174000.webp',
			outputHash: generatedImageHash,
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

		const result = await renderInterior(withKey(bucket), TEST_S3_BUCKET, {
			image: 'https://example.test/room.jpg',
			prompt: '',
			outputFormat: 'webp'
		});

		expect(bucket.put).toHaveBeenCalledWith(
			'123e4567-e89b-12d3-a456-426614174001.png',
			expect.any(ArrayBuffer),
			{ httpMetadata: { contentType: 'image/png' } }
		);
		expect(result.outputKey).toBe('123e4567-e89b-12d3-a456-426614174001.png');
	});

	it('throws a generic error without leaking provider details', async () => {
		archai.postRenderInterior.mockResolvedValue({
			error: { message: 'insufficient balance: account 9f3a' }
		});

		await expect(
			renderInterior(withKey(), TEST_S3_BUCKET, {
				image: 'https://example.test/room.jpg',
				prompt: '',
				outputFormat: 'webp'
			})
		).rejects.toThrow('Render failed');
	});

	it('fails safely in production when the API URL is not configured', async () => {
		appEnvironment.dev = false;
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const platform = { env: { ARCHAI_API_KEY: 'test-key' } } as App.Platform;

		try {
			const render = renderInterior(platform, TEST_S3_BUCKET, {
				image: 'https://example.test/room.jpg',
				prompt: 'cozy',
				outputFormat: 'webp'
			});

			await expect(render).rejects.toThrow(/^Render failed$/);
			await expect(render).rejects.not.toThrow('ARCHAI_API_URL not configured');
			expect(consoleError).toHaveBeenCalledWith(
				'archAI render/interior failed:',
				'ARCHAI_API_URL not configured'
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it('fails when downloading the generated image cannot be completed', async () => {
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
			const render = renderInterior(withKey(), TEST_S3_BUCKET, {
				image: 'https://example.test/room.jpg',
				prompt: '',
				outputFormat: 'webp'
			});

			await expect(render).rejects.toThrow('render/interior output storage failed');
			expect(consoleError).toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});
});

describe('styleTransferInterior', () => {
	it('falls back to the dev mock when no API key is configured', async () => {
		const result = await styleTransferInterior(withoutKey, TEST_S3_BUCKET, {
			image: 'https://example.test/room.jpg',
			referenceImage: 'https://example.test/style.jpg',
			outputFormat: 'webp'
		});
		expect(result.outputKey).toBeTruthy();
	});

	it('throws a generic production misconfiguration error without leaking API key details', async () => {
		appEnvironment.dev = false;
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			const transfer = styleTransferInterior(withoutKey, TEST_S3_BUCKET, {
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

		const result = await styleTransferInterior(withKey(bucket), TEST_S3_BUCKET, {
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
			outputKey: '123e4567-e89b-12d3-a456-426614174004.png',
			outputHash: generatedImageHash,
			cost: 2,
			balance: 22
		});
	});

	it('throws a generic error without leaking provider details', async () => {
		archai.postStyleTransfer.mockResolvedValue({
			error: { message: 'internal provider trace 9f3a' }
		});

		await expect(
			styleTransferInterior(withKey(), TEST_S3_BUCKET, {
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
			styleTransferInterior(withKey(), TEST_S3_BUCKET, {
				image: 'https://example.test/room.jpg',
				referenceImage: 'https://example.test/style.jpg',
				outputFormat: 'webp'
			})
		).rejects.toThrow('Style transfer failed');
	});
});

describe('replaceTexturesWithMask', () => {
	it('falls back to the dev mock when ArchAI is not configured', async () => {
		const result = await replaceTexturesWithMask(withoutKey, TEST_S3_BUCKET, {
			image: 'https://example.test/room.jpg',
			referenceImage: 'https://example.test/texture.jpg',
			mask: 'https://example.test/mask.png'
		});

		expect(result.outputKey).toBeTruthy();
	});

	it('sends the masked reference request and stores the first output image', async () => {
		const bucket = mockBucket();
		mockDownloadedImage('image/png');
		mockImageId('123e4567-e89b-12d3-a456-426614174005');
		archai.postChangeTextures.mockResolvedValue({
			data: {
				output: ['https://example.test/retextured.png'],
				cost: 1.5,
				balance: 20
			}
		});

		const result = await replaceTexturesWithMask(withKey(bucket), TEST_S3_BUCKET, {
			image: 'https://example.test/room.jpg',
			referenceImage: 'https://example.test/texture.jpg',
			mask: 'https://example.test/mask.png'
		});

		expect(archai.postChangeTextures.mock.calls[0][0].body).toEqual({
			image: 'https://example.test/room.jpg',
			referenceImage: 'https://example.test/texture.jpg',
			mask: 'https://example.test/mask.png'
		});
		expect(result).toEqual({
			outputKey: '123e4567-e89b-12d3-a456-426614174005.png',
			outputHash: generatedImageHash,
			cost: 1.5,
			balance: 20
		});
	});

	it('does not leak provider errors', async () => {
		archai.postChangeTextures.mockResolvedValue({
			error: { message: 'private provider trace' }
		});

		await expect(
			replaceTexturesWithMask(withKey(), TEST_S3_BUCKET, {
				image: 'https://example.test/room.jpg',
				referenceImage: 'https://example.test/texture.jpg',
				mask: 'https://example.test/mask.png'
			})
		).rejects.toThrow(/^Texture replacement failed$/);
	});
});
