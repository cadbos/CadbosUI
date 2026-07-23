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
import { createComfyUiClient } from '$lib/server/comfyui/client';
import {
	ComfyUiError,
	type ComfyHistoryEntry,
	type ComfyWorkflow
} from '$lib/server/comfyui/types';

const workflow: ComfyWorkflow = {
	'1': { class_type: 'SaveImage', inputs: { filename_prefix: 'test' } }
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { 'content-type': 'application/json' },
		status
	});
}

function completedHistory(promptId: string, status = 'success'): Record<string, unknown> {
	return {
		[promptId]: {
			outputs: {
				'29': {
					images: [{ filename: 'final.png', subfolder: 'results', type: 'output' }]
				}
			},
			status: { completed: true, status_str: status }
		}
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe('createComfyUiClient', () => {
	it('uploads an image with multipart fields and preserves configured authentication headers', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				jsonResponse({ name: 'scene (1).png', subfolder: 'jobs/one', type: 'input' })
			);
		const client = createComfyUiClient({
			baseUrl: 'https://comfy.example.test/root',
			fetch: fetcher,
			headers: { authorization: 'Bearer test', 'content-type': 'application/json' }
		});

		const result = await client.uploadImage({
			data: new Blob(['image'], { type: 'image/png' }),
			filename: 'scene.png',
			overwrite: false,
			subfolder: 'jobs/one'
		});

		expect(result).toEqual({
			filename: 'scene (1).png',
			subfolder: 'jobs/one',
			type: 'input'
		});
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url?.toString()).toBe('https://comfy.example.test/root/upload/image');
		expect(init?.method).toBe('POST');
		const headers = new Headers(init?.headers);
		expect(headers.get('authorization')).toBe('Bearer test');
		expect(headers.has('content-type')).toBe(false);
		const form = init?.body as FormData;
		expect(form.get('type')).toBe('input');
		expect(form.get('subfolder')).toBe('jobs/one');
		expect(form.get('overwrite')).toBe('false');
		const uploadedFile = form.get('image');
		expect(uploadedFile).toBeInstanceOf(Blob);
		expect((uploadedFile as File).name).toBe('scene.png');
	});

	it('submits the workflow once with optional identifiers', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse({ prompt_id: 'prompt-1', number: 3 }));
		const client = createComfyUiClient({
			baseUrl: new URL('http://127.0.0.1:8188/'),
			fetch: fetcher
		});

		const result = await client.queueWorkflow(workflow, {
			clientId: 'client-1',
			promptId: 'requested-prompt'
		});

		expect(result).toEqual({ promptId: 'prompt-1', queueNumber: 3 });
		expect(fetcher).toHaveBeenCalledTimes(1);
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url?.toString()).toBe('http://127.0.0.1:8188/prompt');
		expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(String(init?.body))).toEqual({
			client_id: 'client-1',
			prompt: workflow,
			prompt_id: 'requested-prompt'
		});
	});

	it('classifies a rejected workflow without exposing the response body', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse({ error: 'private node trace and token' }, 400));
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });

		const error = await client.queueWorkflow(workflow).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(ComfyUiError);
		expect(error).toMatchObject({
			code: 'prompt_rejected',
			operation: 'queue_workflow',
			status: 400
		});
		expect((error as Error).message).not.toContain('private node trace');
	});

	it('surfaces network failures without leaking the underlying error message', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error('proxy authorization secret'));
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });

		const error = await client.getHistory('prompt-1').catch((cause: unknown) => cause);

		expect(error).toMatchObject({ code: 'network_error', operation: 'get_history' });
		expect((error as Error).message).not.toContain('proxy authorization secret');
	});

	it('returns null until history exists and parses a completed entry', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse({}))
			.mockResolvedValueOnce(jsonResponse(completedHistory('prompt/1')));
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });

		const pending = await client.getHistory('prompt/1');
		const completed = await client.getHistory('prompt/1');

		expect(pending).toBeNull();
		expect(completed).toEqual<ComfyHistoryEntry>({
			outputs: {
				'29': {
					images: [{ filename: 'final.png', subfolder: 'results', type: 'output' }]
				}
			},
			promptId: 'prompt/1',
			status: { completed: true, status: 'success' }
		});
		expect(fetcher.mock.calls[0]?.[0].toString()).toContain('history/prompt%2F1');
	});

	it('polls history until completion', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse({}))
			.mockResolvedValueOnce(jsonResponse(completedHistory('prompt-1')));
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });

		const result = await client.waitForCompletion('prompt-1', {
			pollIntervalMs: 1,
			timeoutMs: 100
		});

		expect(result.status).toEqual({ completed: true, status: 'success' });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('surfaces terminal execution failures', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(jsonResponse(completedHistory('prompt-1', 'error')));
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });

		const error = await client
			.waitForCompletion('prompt-1', { pollIntervalMs: 1, timeoutMs: 100 })
			.catch((cause: unknown) => cause);

		expect(error).toMatchObject({
			code: 'execution_failed',
			operation: 'wait_for_completion'
		});
	});

	it('times out an unfinished workflow', async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({}));
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });
		const waiting = client.waitForCompletion('prompt-1', {
			pollIntervalMs: 10,
			timeoutMs: 30
		});
		const assertion = expect(waiting).rejects.toMatchObject({
			code: 'timeout',
			operation: 'wait_for_completion'
		});

		await vi.advanceTimersByTimeAsync(30);
		await assertion;
		expect(fetcher).toHaveBeenCalled();
	});

	it('honors caller cancellation while polling', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });
		const controller = new AbortController();
		controller.abort();

		const error = await client
			.waitForCompletion('prompt-1', { signal: controller.signal })
			.catch((cause: unknown) => cause);

		expect(error).toMatchObject({ code: 'aborted', operation: 'wait_for_completion' });
	});

	it('downloads an encoded output descriptor with image metadata', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response('image-bytes', {
				headers: { 'content-type': 'image/png; charset=binary' }
			})
		);
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });

		const result = await client.downloadImage({
			filename: 'final image.png',
			subfolder: 'job one',
			type: 'output'
		});

		expect(result).toMatchObject({
			contentType: 'image/png',
			filename: 'final image.png',
			subfolder: 'job one',
			type: 'output'
		});
		expect(result.bytes.byteLength).toBeGreaterThan(0);
		const requestedUrl = new URL(fetcher.mock.calls[0]?.[0].toString() ?? '');
		expect(Object.fromEntries(requestedUrl.searchParams)).toEqual({
			filename: 'final image.png',
			subfolder: 'job one',
			type: 'output'
		});
	});

	it('rejects malformed responses and invalid image downloads', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse({ name: 'scene.png', type: 'input' }))
			.mockResolvedValueOnce(
				new Response('not-an-image', { headers: { 'content-type': 'text/plain' } })
			)
			.mockResolvedValueOnce(new Response(null, { headers: { 'content-type': 'image/png' } }));
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });

		await expect(
			client.uploadImage({ data: new Blob(['image']), filename: 'scene.png' })
		).rejects.toMatchObject({ code: 'invalid_response', operation: 'upload_image' });
		await expect(
			client.downloadImage({ filename: 'final.png', subfolder: '', type: 'output' })
		).rejects.toMatchObject({ code: 'invalid_response', operation: 'download_image' });
		await expect(
			client.downloadImage({ filename: 'empty.png', subfolder: '', type: 'output' })
		).rejects.toMatchObject({ code: 'invalid_response', operation: 'download_image' });
	});

	it('rejects unsafe configuration and upload filenames before fetching', async () => {
		const fetcher = vi.fn<typeof fetch>();

		expect(() =>
			createComfyUiClient({ baseUrl: 'https://user:password@example.test', fetch: fetcher })
		).toThrow(ComfyUiError);
		const client = createComfyUiClient({ baseUrl: 'http://localhost:8188', fetch: fetcher });
		await expect(
			client.uploadImage({ data: new Blob(['image']), filename: '../scene.png' })
		).rejects.toMatchObject({ code: 'invalid_request' });
		expect(fetcher).not.toHaveBeenCalled();
	});
});
