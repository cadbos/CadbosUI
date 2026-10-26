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
import { cancelRepaint, countRepaintPromptsAhead, pollRepaint, submitRepaint } from './repaint';
import {
	cancelFluxKontextEdit,
	countFluxKontextEditPromptsAhead,
	pollFluxKontextEdit,
	submitFluxKontextEdit
} from './flux-kontext-edit';
import {
	cancelLightSettings,
	countLightSettingsPromptsAhead,
	pollLightSettings,
	submitLightSettings
} from './light-settings';
import {
	cancelObjectReplacement,
	countObjectReplacementPromptsAhead,
	pollObjectReplacement,
	submitObjectReplacement
} from './object-replacement';
import {
	cancelTextureReplacement,
	countTextureReplacementPromptsAhead,
	pollTextureReplacement,
	submitTextureReplacement
} from './texture-replacement';
import { downloadRemoteImage } from './remote-image';

vi.mock('./remote-image', () => ({
	downloadRemoteImage: vi.fn(async () => ({ bytes: new ArrayBuffer(4), mime: 'image/png' }))
}));

const image = 'https://images.example.test/scene.png';
const origin = 'https://cadbos.example';
const integrations = [
	{
		name: 'repaint',
		submit: (platform: App.Platform) =>
			submitRepaint(platform, { image, target: 'walls', color: '#a3b19b' }, origin, 'job-1'),
		poll: pollRepaint,
		promptsAhead: countRepaintPromptsAhead,
		cancel: cancelRepaint,
		output: '100'
	},
	{
		name: 'edit',
		submit: (platform: App.Platform) =>
			submitFluxKontextEdit(platform, { image, prompt: 'remove chair' }, origin, 'job-1'),
		poll: pollFluxKontextEdit,
		promptsAhead: countFluxKontextEditPromptsAhead,
		cancel: cancelFluxKontextEdit,
		output: '17'
	},
	{
		name: 'lighting',
		submit: (platform: App.Platform) =>
			submitLightSettings(platform, { image, instruction: 'daylight' }, origin, 'job-1'),
		poll: pollLightSettings,
		promptsAhead: countLightSettingsPromptsAhead,
		cancel: cancelLightSettings,
		output: '17'
	},
	{
		name: 'object replacement',
		submit: (platform: App.Platform) =>
			submitObjectReplacement(
				platform,
				{ image, referenceImage: image, replacementObject: 'chair' },
				origin,
				'job-1'
			),
		poll: pollObjectReplacement,
		promptsAhead: countObjectReplacementPromptsAhead,
		cancel: cancelObjectReplacement,
		output: '17'
	},
	{
		name: 'texture replacement',
		submit: (platform: App.Platform) =>
			submitTextureReplacement(
				platform,
				{ image, referenceImage: image, replacementSurface: 'floor' },
				origin,
				'job-1'
			),
		poll: pollTextureReplacement,
		promptsAhead: countTextureReplacementPromptsAhead,
		cancel: cancelTextureReplacement,
		output: '9'
	}
];

function platform(fetcher: typeof fetch, env: Partial<App.Platform['env']> = {}): App.Platform {
	return { env: { COMFYUI_BASE_URL: { fetch: fetcher }, ...env } } as unknown as App.Platform;
}

function stalledRequest(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const signal = init?.signal;
	if (!signal) throw new Error('Missing provider abort signal');
	return new Promise((_resolve, reject) => {
		if (signal.aborted) reject(signal.reason);
		else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

for (const integration of integrations) {
	describe(integration.name, () => {
		it.each(['submit', 'poll', 'cancel'] as const)(
			'aborts a stalled %s using the configured request timeout',
			async (operation) => {
				const fetcher = vi.fn(stalledRequest);
				const configured = platform(fetcher, { COMFYUI_REQUEST_TIMEOUT_MS: '10' });
				const result =
					operation === 'submit'
						? integration.submit(configured)
						: integration[operation](configured, 'prompt-1');
				await expect(result).rejects.toMatchObject({ code: 'aborted' });
				expect(fetcher).toHaveBeenCalledOnce();
			}
		);

		it('bounds the queue lookup by the short queue timeout, not the request timeout', async () => {
			const fetcher = vi.fn(stalledRequest);
			const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
			const configured = platform(fetcher, { COMFYUI_REQUEST_TIMEOUT_MS: '240000' });

			await expect(integration.promptsAhead(configured, 'prompt-1')).rejects.toMatchObject({
				code: 'aborted'
			});
			expect(timeout.mock.calls).toEqual([[5_000]]);
			expect(new URL(fetcher.mock.calls[0]![0].toString()).pathname).toBe('/queue');
		});

		it('passes the configured signal through uploads, submission, history, output download and cancellation', async () => {
			const signal = new AbortController().signal;
			const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
			const paths: string[] = [];
			const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(init?.signal).toBe(signal);
				const path = new URL(input.toString()).pathname;
				paths.push(path);
				if (path === '/upload/image')
					return Response.json({ name: 'input.png', subfolder: '', type: 'input' });
				if (path === '/prompt') return Response.json({ prompt_id: 'prompt-1', number: 0 });
				if (path === '/history/prompt-1')
					return Response.json({
						'prompt-1': {
							status: { completed: true, status_str: 'success' },
							outputs: {
								[integration.output]: {
									images: [{ filename: 'output.png', subfolder: '', type: 'output' }]
								}
							}
						}
					});
				if (path === '/view')
					return new Response('image-bytes', { headers: { 'content-type': 'image/png' } });
				if (path === '/api/jobs/prompt-1/cancel') return Response.json({ cancelled: true });
				throw new Error(`Unexpected provider request: ${path}`);
			});
			const configured = platform(fetcher, { COMFYUI_REQUEST_TIMEOUT_MS: '240000' });
			expect(await integration.submit(configured)).toBe('prompt-1');
			expect(await integration.poll(configured, 'prompt-1')).toMatchObject({
				image: { contentType: 'image/png' }
			});
			await integration.cancel(configured, 'prompt-1');
			expect(paths).toEqual(
				expect.arrayContaining([
					'/upload/image',
					'/prompt',
					'/history/prompt-1',
					'/view',
					'/api/jobs/prompt-1/cancel'
				])
			);
			expect(timeout.mock.calls).toEqual([[240_000], [240_000], [240_000]]);
		});

		it.each(['COMFYUI_JOB_TIMEOUT_MS', 'COMFYUI_REQUEST_TIMEOUT_MS'] as const)(
			'rejects invalid %s before fetching inputs or submitting work',
			async (variable) => {
				const fetcher = vi.fn(stalledRequest);
				await expect(
					integration.submit(platform(fetcher, { [variable]: 'private-invalid-value' }))
				).rejects.toThrow(`${variable} is invalid`);
				expect(fetcher).not.toHaveBeenCalled();
				expect(downloadRemoteImage).not.toHaveBeenCalled();
			}
		);
	});
}
