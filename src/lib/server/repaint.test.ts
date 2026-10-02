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
import type { Fetcher } from '@cloudflare/workers-types';
import type { ComfyDownloadedImage } from '$lib/server/comfyui';
import { repaintCost, pollRepaint, submitRepaint } from '$lib/server/repaint';

function platform(env: Partial<App.Platform['env']>): App.Platform {
	return { env } as App.Platform;
}

function vpcService(fetchImpl: typeof fetch): Fetcher {
	return { fetch: fetchImpl } as unknown as Fetcher;
}

describe('repaint integration', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses the default or configured positive tariff', () => {
		expect(repaintCost(platform({}))).toBe(0.03);
		expect(repaintCost(platform({ REPAINT_COST: '3.5' }))).toBe(3.5);
		expect(() => repaintCost(platform({ REPAINT_COST: 'free' }))).toThrow('Invalid repaint cost');
	});

	it('requires the private ComfyUI base URL before fetching inputs', async () => {
		const fetcher = vi.spyOn(globalThis, 'fetch');

		await expect(
			submitRepaint(
				platform({}),
				{ image: 'https://images.example.test/scene.png', target: 'стены', color: '#a3b19b' },
				'https://cadbos.example',
				'job-1'
			)
		).rejects.toMatchObject({ code: 'invalid_configuration' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('uploads the fetched scene and a generated color swatch, then submits over the ComfyUI VPC service, unauthenticated', async () => {
		const imageFetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			return new Response('image-bytes', { headers: { 'content-type': 'image/png' } });
		});

		const uploads: File[] = [];
		const vpcFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input.toString());
			if (url.pathname === '/upload/image') {
				const image = (init?.body as FormData).get('image');
				if (!(image instanceof File)) throw new Error('Missing uploaded image');
				uploads.push(image);
				return new Response(JSON.stringify({ name: image.name, subfolder: '', type: 'input' }), {
					headers: { 'content-type': 'application/json' }
				});
			}
			if (url.pathname === '/prompt') {
				expect(new Headers(init?.headers).has('authorization')).toBe(false);
				expect(new Headers(init?.headers).has('x-api-key')).toBe(false);
				return new Response(JSON.stringify({ prompt_id: 'prompt-1', number: 1 }), {
					headers: { 'content-type': 'application/json' }
				});
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		await expect(
			submitRepaint(
				platform({ COMFYUI_BASE_URL: vpcService(vpcFetch) }),
				{ image: 'https://images.example.test/scene.png', target: 'стены', color: '#a3b19b' },
				'https://cadbos.example',
				'job-1'
			)
		).resolves.toBe('prompt-1');
		expect(imageFetcher).toHaveBeenCalledTimes(1);
		expect(vpcFetch).toHaveBeenCalledTimes(3);
		expect(uploads.map((upload) => [upload.name, upload.type])).toEqual([
			['job-1-scene.png', 'image/png'],
			['job-1-swatch.png', 'image/png']
		]);
		const swatchSignature = new Uint8Array(await uploads[1].arrayBuffer()).slice(0, 8);
		expect([...swatchSignature]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	});

	it('requires configuration when polling', async () => {
		await expect(pollRepaint(platform({}), 'prompt-1')).rejects.toMatchObject({
			code: 'invalid_configuration'
		});
	});

	it('polls history and downloads the completed image over the ComfyUI VPC service', async () => {
		const vpcFetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input.toString());
			if (url.pathname === '/history/prompt-1') {
				return new Response(
					JSON.stringify({
						'prompt-1': {
							outputs: {
								'100': { images: [{ filename: 'final.png', subfolder: 'results', type: 'output' }] }
							},
							status: { completed: true, status_str: 'success' }
						}
					}),
					{ headers: { 'content-type': 'application/json' } }
				);
			}
			if (url.pathname === '/view') {
				return new Response('image-bytes', { headers: { 'content-type': 'image/png' } });
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const result = await pollRepaint(
			platform({ COMFYUI_BASE_URL: vpcService(vpcFetch) }),
			'prompt-1'
		);

		expect(result).toEqual<{
			completedAt: number;
			executionStartedAt: number | null;
			executionSucceededAt: number | null;
			downloadSec: number;
			image: ComfyDownloadedImage;
		}>({
			completedAt: expect.any(Number),
			executionStartedAt: null,
			executionSucceededAt: null,
			downloadSec: expect.any(Number),
			image: {
				filename: 'final.png',
				subfolder: 'results',
				type: 'output',
				bytes: expect.any(ArrayBuffer),
				contentType: 'image/png'
			}
		});
		expect(vpcFetch).toHaveBeenCalledTimes(2);
	});
});
