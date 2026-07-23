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
import {
	objectReplacementCost,
	pollObjectReplacement,
	submitObjectReplacement
} from '$lib/server/object-replacement';

function platform(env: Partial<App.Platform['env']>): App.Platform {
	return { env } as App.Platform;
}

function vpcService(fetchImpl: typeof fetch): Fetcher {
	return { fetch: fetchImpl } as unknown as Fetcher;
}

describe('object replacement integration', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses the default or configured positive tariff', () => {
		expect(objectReplacementCost(platform({}))).toBe(0.03);
		expect(objectReplacementCost(platform({ OBJECT_REPLACEMENT_COST: '3.5' }))).toBe(3.5);
		expect(() => objectReplacementCost(platform({ OBJECT_REPLACEMENT_COST: 'free' }))).toThrow(
			'Invalid object replacement cost'
		);
	});

	it('requires the private ComfyUI base URL before fetching inputs', async () => {
		const fetcher = vi.spyOn(globalThis, 'fetch');

		await expect(
			submitObjectReplacement(
				platform({}),
				{
					image: 'https://images.example.test/scene.png',
					referenceImage: 'https://images.example.test/reference.png',
					replacementObject: 'sofa'
				},
				'https://cadbos.example',
				'job-1'
			)
		).rejects.toMatchObject({ code: 'invalid_configuration' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('fetches validated inputs and submits over the ComfyUI VPC service, unauthenticated', async () => {
		const imageFetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			return new Response('image-bytes', { headers: { 'content-type': 'image/png' } });
		});

		let uploadCount = 0;
		const vpcFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input.toString());
			if (url.pathname === '/upload/image') {
				uploadCount += 1;
				return new Response(
					JSON.stringify({
						name: uploadCount === 1 ? 'scene.png' : 'reference.png',
						subfolder: '',
						type: 'input'
					}),
					{ headers: { 'content-type': 'application/json' } }
				);
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
			submitObjectReplacement(
				platform({ COMFYUI_BASE_URL: vpcService(vpcFetch) }),
				{
					image: 'https://images.example.test/scene.png',
					referenceImage: 'https://images.example.test/reference.png',
					replacementObject: 'sofa'
				},
				'https://cadbos.example',
				'job-1'
			)
		).resolves.toBe('prompt-1');
		expect(imageFetcher).toHaveBeenCalledTimes(2);
		expect(vpcFetch).toHaveBeenCalledTimes(3);
	});

	it('requires configuration when polling', async () => {
		await expect(pollObjectReplacement(platform({}), 'prompt-1')).rejects.toMatchObject({
			code: 'invalid_configuration'
		});
	});
});
