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
import {
	fluxKontextEditCost,
	pollFluxKontextEdit,
	submitFluxKontextEdit
} from '$lib/server/flux-kontext-edit';

function platform(env: Partial<App.Platform['env']>): App.Platform {
	return { env } as App.Platform;
}

function vpcService(fetchImpl: typeof fetch): Fetcher {
	return { fetch: fetchImpl } as unknown as Fetcher;
}

describe('flux kontext edit integration', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses the default or configured positive tariff', () => {
		expect(fluxKontextEditCost(platform({}))).toBe(0.03);
		expect(fluxKontextEditCost(platform({ FLUX_KONTEXT_EDIT_COST: '3.5' }))).toBe(3.5);
		expect(() => fluxKontextEditCost(platform({ FLUX_KONTEXT_EDIT_COST: 'free' }))).toThrow(
			'Invalid Flux Kontext edit cost'
		);
	});

	it('requires the private ComfyUI base URL before fetching inputs', async () => {
		const fetcher = vi.spyOn(globalThis, 'fetch');

		await expect(
			submitFluxKontextEdit(
				platform({}),
				{ image: 'https://images.example.test/scene.png', prompt: 'make the walls white' },
				'https://cadbos.example',
				'job-1'
			)
		).rejects.toMatchObject({ code: 'invalid_configuration' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('fetches the validated scene and submits over the ComfyUI VPC service, unauthenticated', async () => {
		const imageFetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			return new Response('image-bytes', { headers: { 'content-type': 'image/png' } });
		});

		const vpcFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input.toString());
			if (url.pathname === '/upload/image') {
				return new Response(JSON.stringify({ name: 'scene.png', subfolder: '', type: 'input' }), {
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
			submitFluxKontextEdit(
				platform({ COMFYUI_BASE_URL: vpcService(vpcFetch) }),
				{ image: 'https://images.example.test/scene.png', prompt: 'make the walls white' },
				'https://cadbos.example',
				'job-1'
			)
		).resolves.toBe('prompt-1');
		expect(imageFetcher).toHaveBeenCalledTimes(1);
		expect(vpcFetch).toHaveBeenCalledTimes(2);
	});

	it('requires configuration when polling', async () => {
		await expect(pollFluxKontextEdit(platform({}), 'prompt-1')).rejects.toMatchObject({
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
								'17': { images: [{ filename: 'final.png', subfolder: 'results', type: 'output' }] }
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

		const result = await pollFluxKontextEdit(
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
