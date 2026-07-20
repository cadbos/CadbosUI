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

import {
	ComfyUiError,
	type ComfyDownloadedImage,
	type ComfyHistoryEntry,
	type ComfyHistoryNodeOutput,
	type ComfyImageDescriptor,
	type ComfyImageStorageType,
	type ComfyImageUpload,
	type ComfyQueueOptions,
	type ComfyQueuedWorkflow,
	type ComfyRequestOptions,
	type ComfyUiClient,
	type ComfyUiClientOptions,
	type ComfyUiOperation,
	type ComfyWaitOptions,
	type ComfyWorkflow
} from '$lib/server/comfyui/types';

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const IMAGE_STORAGE_TYPES = new Set<ComfyImageStorageType>(['input', 'output', 'temp']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isImageStorageType(value: unknown): value is ComfyImageStorageType {
	return typeof value === 'string' && IMAGE_STORAGE_TYPES.has(value as ComfyImageStorageType);
}

function parseImageDescriptor(value: unknown): ComfyImageDescriptor | null {
	if (!isRecord(value)) return null;
	const filename = typeof value.filename === 'string' ? value.filename : value.name;
	if (
		typeof filename !== 'string' ||
		filename.length === 0 ||
		typeof value.subfolder !== 'string' ||
		!isImageStorageType(value.type)
	) {
		return null;
	}
	return { filename, subfolder: value.subfolder, type: value.type };
}

function parseHistoryEntry(promptId: string, value: unknown): ComfyHistoryEntry | null {
	if (!isRecord(value) || !isRecord(value.status) || !isRecord(value.outputs)) return null;
	const completed = value.status.completed;
	const status = value.status.status_str;
	if (typeof completed !== 'boolean' || typeof status !== 'string') return null;

	const outputs: Record<string, ComfyHistoryNodeOutput> = {};
	for (const [nodeId, nodeOutput] of Object.entries(value.outputs)) {
		if (!isRecord(nodeOutput)) return null;
		if (nodeOutput.images === undefined) {
			outputs[nodeId] = {};
			continue;
		}
		if (!Array.isArray(nodeOutput.images)) return null;
		const images = nodeOutput.images.map(parseImageDescriptor);
		if (images.some((image) => image === null)) return null;
		outputs[nodeId] = { images: images as ComfyImageDescriptor[] };
	}

	return { promptId, outputs, status: { completed, status } };
}

function normalizeBaseUrl(value: string | URL): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (cause) {
		throw new ComfyUiError('invalid_configuration', 'configuration', 'Invalid ComfyUI base URL', {
			cause
		});
	}
	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.username.length > 0 ||
		url.password.length > 0
	) {
		throw new ComfyUiError('invalid_configuration', 'configuration', 'Invalid ComfyUI base URL');
	}
	url.hash = '';
	url.search = '';
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	return url;
}

function validateNonEmpty(value: unknown, operation: ComfyUiOperation, field: string): string {
	if (typeof value !== 'string') {
		throw new ComfyUiError('invalid_request', operation, `Invalid ${field}`);
	}
	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new ComfyUiError('invalid_request', operation, `Invalid ${field}`);
	}
	return normalized;
}

function validatePositiveNumber(value: number, field: string): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new ComfyUiError('invalid_request', 'wait_for_completion', `Invalid ${field}`);
	}
}

function validateWorkflow(workflow: ComfyWorkflow): void {
	if (!isRecord(workflow) || Object.keys(workflow).length === 0) {
		throw new ComfyUiError('invalid_request', 'queue_workflow', 'Invalid ComfyUI workflow');
	}
	for (const node of Object.values(workflow)) {
		if (!isRecord(node) || typeof node.class_type !== 'string' || !isRecord(node.inputs)) {
			throw new ComfyUiError('invalid_request', 'queue_workflow', 'Invalid ComfyUI workflow');
		}
	}
}

function requestHeaders(defaultHeaders: Headers, json: boolean): Headers {
	const headers = new Headers(defaultHeaders);
	if (json) headers.set('content-type', 'application/json');
	else headers.delete('content-type');
	return headers;
}

async function responseJson(response: Response, operation: ComfyUiOperation): Promise<unknown> {
	try {
		return await response.json();
	} catch (cause) {
		throw new ComfyUiError('invalid_response', operation, 'Invalid response from ComfyUI', {
			cause,
			status: response.status
		});
	}
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		throw new ComfyUiError('aborted', 'wait_for_completion', 'ComfyUI request was aborted');
	}
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener('abort', abort);
			resolve();
		}, milliseconds);
		const abort = (): void => {
			clearTimeout(timeout);
			reject(new ComfyUiError('aborted', 'wait_for_completion', 'ComfyUI request was aborted'));
		};
		signal.addEventListener('abort', abort, { once: true });
	});
}

export function createComfyUiClient(options: ComfyUiClientOptions): ComfyUiClient {
	const baseUrl = normalizeBaseUrl(options.baseUrl);
	const fetcher = options.fetch ?? globalThis.fetch;
	const defaultHeaders = new Headers(options.headers);

	function endpoint(path: string): URL {
		return new URL(path, baseUrl);
	}

	async function request(
		operation: ComfyUiOperation,
		url: URL,
		init: RequestInit
	): Promise<Response> {
		try {
			return await fetcher(url, init);
		} catch (cause) {
			if (init.signal?.aborted) {
				throw new ComfyUiError('aborted', operation, 'ComfyUI request was aborted', { cause });
			}
			throw new ComfyUiError('network_error', operation, 'Could not reach ComfyUI', { cause });
		}
	}

	async function uploadImage(
		image: ComfyImageUpload,
		requestOptions: ComfyRequestOptions = {}
	): Promise<ComfyImageDescriptor> {
		const filename = validateNonEmpty(image.filename, 'upload_image', 'image filename');
		if (
			filename.includes('/') ||
			filename.includes('\\') ||
			!(image.data instanceof Blob) ||
			(image.subfolder !== undefined && typeof image.subfolder !== 'string') ||
			(image.type !== undefined && !isImageStorageType(image.type))
		) {
			throw new ComfyUiError('invalid_request', 'upload_image', 'Invalid image upload');
		}
		if (image.data.size === 0) {
			throw new ComfyUiError('invalid_request', 'upload_image', 'Invalid image upload');
		}

		const form = new FormData();
		form.append('image', image.data, filename);
		form.append('type', image.type ?? 'input');
		if (image.subfolder !== undefined) form.append('subfolder', image.subfolder);
		if (image.overwrite !== undefined) form.append('overwrite', String(image.overwrite));

		const response = await request('upload_image', endpoint('upload/image'), {
			body: form,
			headers: requestHeaders(defaultHeaders, false),
			method: 'POST',
			signal: requestOptions.signal
		});
		if (!response.ok) {
			throw new ComfyUiError('http_error', 'upload_image', 'ComfyUI image upload failed', {
				status: response.status
			});
		}
		const descriptor = parseImageDescriptor(await responseJson(response, 'upload_image'));
		if (descriptor === null) {
			throw new ComfyUiError('invalid_response', 'upload_image', 'Invalid response from ComfyUI', {
				status: response.status
			});
		}
		return descriptor;
	}

	async function queueWorkflow(
		workflow: ComfyWorkflow,
		queueOptions: ComfyQueueOptions = {}
	): Promise<ComfyQueuedWorkflow> {
		validateWorkflow(workflow);
		const response = await request('queue_workflow', endpoint('prompt'), {
			body: JSON.stringify({
				prompt: workflow,
				...(queueOptions.clientId ? { client_id: queueOptions.clientId } : {}),
				...(queueOptions.promptId ? { prompt_id: queueOptions.promptId } : {})
			}),
			headers: requestHeaders(defaultHeaders, true),
			method: 'POST',
			signal: queueOptions.signal
		});
		if (!response.ok) {
			throw new ComfyUiError(
				response.status === 400 ? 'prompt_rejected' : 'http_error',
				'queue_workflow',
				response.status === 400
					? 'ComfyUI rejected the workflow'
					: 'ComfyUI workflow submission failed',
				{ status: response.status }
			);
		}
		const body = await responseJson(response, 'queue_workflow');
		if (
			!isRecord(body) ||
			typeof body.prompt_id !== 'string' ||
			body.prompt_id.length === 0 ||
			typeof body.number !== 'number' ||
			!Number.isFinite(body.number)
		) {
			throw new ComfyUiError(
				'invalid_response',
				'queue_workflow',
				'Invalid response from ComfyUI',
				{ status: response.status }
			);
		}
		return { promptId: body.prompt_id, queueNumber: body.number };
	}

	async function getHistory(
		promptId: string,
		requestOptions: ComfyRequestOptions = {}
	): Promise<ComfyHistoryEntry | null> {
		const normalizedPromptId = validateNonEmpty(promptId, 'get_history', 'prompt ID');
		const response = await request(
			'get_history',
			endpoint(`history/${encodeURIComponent(normalizedPromptId)}`),
			{
				headers: requestHeaders(defaultHeaders, false),
				method: 'GET',
				signal: requestOptions.signal
			}
		);
		if (!response.ok) {
			throw new ComfyUiError('http_error', 'get_history', 'Could not read ComfyUI history', {
				status: response.status
			});
		}
		const body = await responseJson(response, 'get_history');
		if (!isRecord(body)) {
			throw new ComfyUiError('invalid_response', 'get_history', 'Invalid response from ComfyUI', {
				status: response.status
			});
		}
		if (!(normalizedPromptId in body)) return null;
		const entry = parseHistoryEntry(normalizedPromptId, body[normalizedPromptId]);
		if (entry === null) {
			throw new ComfyUiError('invalid_response', 'get_history', 'Invalid response from ComfyUI', {
				status: response.status
			});
		}
		return entry;
	}

	async function waitForCompletion(
		promptId: string,
		waitOptions: ComfyWaitOptions = {}
	): Promise<ComfyHistoryEntry> {
		const timeoutMs = waitOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const pollIntervalMs = waitOptions.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		validatePositiveNumber(timeoutMs, 'timeout');
		validatePositiveNumber(pollIntervalMs, 'poll interval');

		const timeoutController = new AbortController();
		const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
		const signal = waitOptions.signal
			? AbortSignal.any([waitOptions.signal, timeoutController.signal])
			: timeoutController.signal;

		try {
			while (true) {
				const entry = await getHistory(promptId, { signal });
				if (entry !== null) {
					if (entry.status.status === 'error') {
						throw new ComfyUiError(
							'execution_failed',
							'wait_for_completion',
							'ComfyUI workflow execution failed'
						);
					}
					if (entry.status.completed) {
						if (entry.status.status === 'success') return entry;
						throw new ComfyUiError(
							'execution_failed',
							'wait_for_completion',
							'ComfyUI workflow execution failed'
						);
					}
				}
				await abortableDelay(pollIntervalMs, signal);
			}
		} catch (cause) {
			if (waitOptions.signal?.aborted) {
				throw new ComfyUiError('aborted', 'wait_for_completion', 'ComfyUI request was aborted', {
					cause
				});
			}
			if (timeoutController.signal.aborted) {
				throw new ComfyUiError('timeout', 'wait_for_completion', 'Timed out waiting for ComfyUI', {
					cause
				});
			}
			throw cause;
		} finally {
			clearTimeout(timeout);
		}
	}

	async function downloadImage(
		image: ComfyImageDescriptor,
		requestOptions: ComfyRequestOptions = {}
	): Promise<ComfyDownloadedImage> {
		const filename = validateNonEmpty(image.filename, 'download_image', 'image filename');
		if (typeof image.subfolder !== 'string' || !isImageStorageType(image.type)) {
			throw new ComfyUiError('invalid_request', 'download_image', 'Invalid image descriptor');
		}
		const url = endpoint('view');
		url.search = new URLSearchParams({
			filename,
			subfolder: image.subfolder,
			type: image.type
		}).toString();
		const response = await request('download_image', url, {
			headers: requestHeaders(defaultHeaders, false),
			method: 'GET',
			signal: requestOptions.signal
		});
		if (!response.ok) {
			throw new ComfyUiError('http_error', 'download_image', 'Could not download ComfyUI image', {
				status: response.status
			});
		}
		const contentType = (response.headers.get('content-type') ?? '')
			.split(';', 1)[0]
			?.trim()
			.toLowerCase();
		if (!contentType?.startsWith('image/')) {
			throw new ComfyUiError(
				'invalid_response',
				'download_image',
				'Invalid image response from ComfyUI',
				{ status: response.status }
			);
		}
		let bytes: ArrayBuffer;
		try {
			bytes = await response.arrayBuffer();
		} catch (cause) {
			throw new ComfyUiError(
				'invalid_response',
				'download_image',
				'Invalid image response from ComfyUI',
				{ cause, status: response.status }
			);
		}
		if (bytes.byteLength === 0) {
			throw new ComfyUiError(
				'invalid_response',
				'download_image',
				'Invalid image response from ComfyUI',
				{ status: response.status }
			);
		}
		return { ...image, bytes, contentType };
	}

	return { downloadImage, getHistory, queueWorkflow, uploadImage, waitForCompletion };
}
