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
import { submitTextureReplacement } from '$lib/server/texture-replacement';

function platform(env: Partial<App.Platform['env']>): App.Platform {
	return { env } as App.Platform;
}

function vpcService(fetchImpl: typeof fetch): Fetcher {
	return { fetch: fetchImpl } as unknown as Fetcher;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

describe('texture replacement integration', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns the hash of the downloaded scene with the accepted ComfyUI prompt', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const body = input.toString().includes('/scene.png') ? 'scene-bytes' : 'reference-bytes';
			return new Response(body, { headers: { 'content-type': 'image/png' } });
		});

		let uploadCount = 0;
		const vpcFetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(input.toString());
			if (url.pathname === '/upload/image') {
				uploadCount += 1;
				return Response.json({
					name: uploadCount === 1 ? 'scene.png' : 'reference.png',
					subfolder: '',
					type: 'input'
				});
			}
			if (url.pathname === '/prompt') {
				return Response.json({ prompt_id: 'prompt-1', number: 1 });
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const submission = await submitTextureReplacement(
			platform({ COMFYUI_BASE_URL: vpcService(vpcFetch) }),
			{
				image: 'https://images.example.test/scene.png',
				referenceImage: 'https://images.example.test/reference.png',
				replacementSurface: 'floor',
				sessionId: 'test-session-id'
			},
			'https://cadbos.example',
			'job-1'
		);

		expect(submission).toEqual({
			comfyPromptId: 'prompt-1',
			sceneHash: await sha256Hex('scene-bytes')
		});
		expect(submission.sceneHash).not.toBe(await sha256Hex('reference-bytes'));
	});
});
