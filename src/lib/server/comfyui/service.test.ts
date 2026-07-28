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
	customWorkflowsAvailable,
	getComfyUiClient,
	requireHealthyComfyUiClient
} from '$lib/server/comfyui/service';

function platform(fetchImpl?: typeof fetch): App.Platform | undefined {
	if (!fetchImpl) return undefined;
	return {
		env: { COMFYUI_BASE_URL: { fetch: fetchImpl } as unknown as Fetcher }
	} as App.Platform;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { 'content-type': 'application/json' },
		status
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ComfyUI server service', () => {
	it('creates one private client and reports a valid health response as available', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse({ system: { comfyui_version: '1.0.0' }, devices: [] }));
		const requestPlatform = platform(fetcher);

		await expect(customWorkflowsAvailable(requestPlatform)).resolves.toBe(true);
		expect(getComfyUiClient(requestPlatform)).toBeDefined();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher.mock.calls[0]?.[0].toString()).toBe('http://localhost:8188/system_stats');
	});

	it('fails closed and logs only sanitized health metadata', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse({ error: 'private provider trace' }, 503));
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(customWorkflowsAvailable(platform(fetcher))).resolves.toBe(false);

		expect(consoleWarn).toHaveBeenCalledWith(
			JSON.stringify({
				level: 'warn',
				area: 'custom-workflows',
				event: 'health_check_failed',
				providerCode: 'http_error',
				providerOperation: 'health_check',
				providerStatus: 503
			})
		);
		expect(consoleWarn.mock.calls.flat().join(' ')).not.toContain('private provider trace');
	});

	it('classifies missing private configuration as an unavailable health check', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await expect(customWorkflowsAvailable(undefined)).resolves.toBe(false);
		await expect(requireHealthyComfyUiClient(undefined)).rejects.toMatchObject({
			code: 'invalid_configuration',
			operation: 'health_check'
		});
		expect(() => getComfyUiClient(undefined)).toThrow('ComfyUI VPC service not configured');
	});

	it('times out a stalled private health probe', async () => {
		const fetcher = vi.fn<typeof fetch>((_input, init) => {
			return new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				if (signal?.aborted) {
					reject(new DOMException('aborted', 'AbortError'));
					return;
				}
				signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
					once: true
				});
			});
		});

		await expect(requireHealthyComfyUiClient(platform(fetcher))).rejects.toMatchObject({
			code: 'aborted',
			operation: 'health_check'
		});
	}, 5_000);
});
