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

import { dev } from '$app/environment';
import { createClient } from '$lib/server/archai/client';
import {
	postChangeTextures,
	postEditByPrompt,
	postRenderExterior,
	postRenderInterior,
	postStyleTransfer,
	postUpscale4K
} from '$lib/server/archai';
import type { ArrayGenerationResponse, SingleGenerationResponse } from '$lib/server/archai';
import type { OutputFormat } from '$lib/api/contract';
import { imageExtensionFromMime } from '$lib/image-mime';
import type { Bucket } from '$lib/server/media';
import {
	mockEdit,
	mockMaskedTextureReplacement,
	mockRender,
	mockRenderExterior,
	mockStyleTransfer,
	mockUpscale
} from '$lib/server/mocks/fixtures';
import { uploadGeneratedImageBytes } from '$lib/server/uploads';
import { downloadRemoteImage, RemoteImageImportError } from '$lib/server/remote-image';

// И-MA-6 / И-MA-ED3: default sync-call timeout, shared by render and edit.
const RENDER_TIMEOUT_MS = 120_000;
const MAX_GENERATED_IMAGE_SIZE = 32 * 1024 * 1024;
const RETRY_DELAYS_MS = [0, 250, 1_000] as const;

export interface StoredRenderResponse {
	outputKey: string;
	outputHash: string;
	cost: number;
	balance: number;
}

// Provider error details (raw response text, internal ids) must stay server-side
// (NFR-6/8) — log them here and surface only a generic, operation-appropriate
// message to the caller, which the route handler passes straight through to the
// client.
function generationFailed(operation: string, clientMessage: string, detail: unknown): never {
	console.error(`archAI ${operation} failed:`, detail);
	throw new Error(clientMessage);
}

function requestClientFor(apiKey: string, apiUrl: string): ReturnType<typeof createClient> {
	// Per-request client — setting headers on the singleton is not safe in Workers.
	return createClient({
		baseUrl: apiUrl,
		headers: { 'x-api-key': apiKey }
	});
}

function caughtErrorKind(err: unknown): string {
	return err instanceof Error ? err.name : typeof err;
}

async function retry<T>(operation: string, call: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (const delay of RETRY_DELAYS_MS) {
		if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
		try {
			return await call();
		} catch (error) {
			if (error instanceof RemoteImageImportError && error.code !== 'remote_fetch_failed') {
				throw error;
			}
			lastError = error;
		}
	}
	throw new Error(`${operation} failed (${caughtErrorKind(lastError)})`);
}

async function storeGeneratedImage(
	platform: App.Platform | undefined,
	bucket: Bucket,
	imageUrl: string,
	operation: string
): Promise<{ key: string; hash: string }> {
	try {
		const downloaded = await retry('download', async () => {
			const image = await downloadRemoteImage(
				imageUrl,
				undefined,
				globalThis.fetch,
				MAX_GENERATED_IMAGE_SIZE
			);
			const extension = imageExtensionFromMime(image.mime);
			if (extension === null) throw new Error('unexpected content type');
			return { ...image, contentType: image.mime, extension };
		});
		const key = `${crypto.randomUUID()}.${downloaded.extension}`;
		const stored = await uploadGeneratedImageBytes(
			platform,
			bucket,
			downloaded.bytes,
			downloaded.contentType,
			key
		);
		return { key: stored.key, hash: stored.hash };
	} catch (err) {
		console.error(
			`archAI ${operation} image mirror failed after successful generation:`,
			caughtErrorKind(err)
		);
		throw new Error(`${operation} output storage failed`, { cause: err });
	}
}

// Shared by renderInterior/renderExterior/upscale4k: all three call an archAI
// endpoint that returns either a single output URL or an array of them, and
// all fail the same way (network error, provider error, empty/missing output).
async function processRenderResult(
	operation: string,
	clientMessage: string,
	platform: App.Platform | undefined,
	bucket: Bucket,
	call: () => Promise<{
		data?: ArrayGenerationResponse | SingleGenerationResponse;
		error?: unknown;
	}>
): Promise<StoredRenderResponse> {
	let result: Awaited<ReturnType<typeof call>>;
	try {
		result = await call();
	} catch (err) {
		generationFailed(operation, clientMessage, err);
	}

	if (result.error) generationFailed(operation, clientMessage, result.error);

	const data = result.data;
	if (!data) {
		generationFailed(operation, clientMessage, 'empty response from generation service');
	}

	const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
	if (!outputUrl) {
		generationFailed(
			operation,
			clientMessage,
			`no image URL in output: ${JSON.stringify(data.output)}`
		);
	}

	const output = await storeGeneratedImage(platform, bucket, outputUrl, operation);
	return {
		outputKey: output.key,
		outputHash: output.hash,
		cost: data.cost,
		balance: data.balance
	};
}

export async function renderInterior(
	platform: App.Platform | undefined,
	bucket: Bucket | undefined,
	params: { image: string; prompt: string; outputFormat: OutputFormat }
): Promise<StoredRenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) {
			const mock = mockRender();
			return {
				...mock,
				outputKey: new URL(mock.outputUrl).pathname.replace(/^\//, ''),
				outputHash: ''
			};
		}
		generationFailed(
			'render/interior',
			'Render failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}
	if (!bucket) generationFailed('render/interior', 'Render failed', 'bucket not configured');

	return processRenderResult('render/interior', 'Render failed', platform, bucket, () =>
		postRenderInterior({
			client: requestClientFor(apiKey, apiUrl),
			signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
			body: {
				image: params.image,
				outputFormat: params.outputFormat,
				// Omit empty prompt — API treats its absence as Enhance mode.
				...(params.prompt ? { prompt: params.prompt } : {})
			}
		})
	);
}

export async function renderExterior(
	platform: App.Platform | undefined,
	bucket: Bucket | undefined,
	params: { image: string; prompt: string; outputFormat: OutputFormat }
): Promise<StoredRenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) {
			const mock = mockRenderExterior();
			return {
				...mock,
				outputKey: new URL(mock.outputUrl).pathname.replace(/^\//, ''),
				outputHash: ''
			};
		}
		generationFailed(
			'render/exterior',
			'Render failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}
	if (!bucket) generationFailed('render/exterior', 'Render failed', 'bucket not configured');

	return processRenderResult('render/exterior', 'Render failed', platform, bucket, () =>
		postRenderExterior({
			client: requestClientFor(apiKey, apiUrl),
			signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
			body: {
				image: params.image,
				outputFormat: params.outputFormat,
				...(params.prompt ? { prompt: params.prompt } : {})
			}
		})
	);
}

// Д-17: `image` is a freshly signed URL for the managed render being edited.
// No outputFormat — aspect
// ratio is preserved automatically (И-MA-ED1).
export async function editInterior(
	platform: App.Platform | undefined,
	bucket: Bucket | undefined,
	params: { image: string; prompt: string }
): Promise<StoredRenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) {
			const mock = mockEdit();
			return {
				...mock,
				outputKey: new URL(mock.outputUrl).pathname.replace(/^\//, ''),
				outputHash: ''
			};
		}
		generationFailed(
			'edit-by-prompt',
			'Edit failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}
	if (!bucket) generationFailed('edit-by-prompt', 'Edit failed', 'bucket not configured');

	let result: Awaited<ReturnType<typeof postEditByPrompt>>;
	try {
		result = await postEditByPrompt({
			client: requestClientFor(apiKey, apiUrl),
			signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
			body: { image: params.image, prompt: params.prompt }
		});
	} catch (err) {
		generationFailed('edit-by-prompt', 'Edit failed', err);
	}

	if (result.error) generationFailed('edit-by-prompt', 'Edit failed', result.error);

	const data = result.data;
	if (!data) {
		generationFailed('edit-by-prompt', 'Edit failed', 'empty response from edit service');
	}

	// И-MA-ED2: output is always a single URL string, unlike render/interior's
	// array-or-string response (И-MA-4).
	if (!data.output) {
		generationFailed(
			'edit-by-prompt',
			'Edit failed',
			`no image URL in output: ${JSON.stringify(data.output)}`
		);
	}

	const output = await storeGeneratedImage(platform, bucket, data.output, 'edit-by-prompt');
	return {
		outputKey: output.key,
		outputHash: output.hash,
		cost: data.cost,
		balance: data.balance
	};
}

export async function styleTransferInterior(
	platform: App.Platform | undefined,
	bucket: Bucket | undefined,
	params: {
		image: string;
		referenceImage: string;
		outputFormat: OutputFormat;
		prompt?: string | undefined;
		negativePrompt?: string | undefined;
		styleTransferStrength?: number | undefined;
	}
): Promise<StoredRenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) {
			const mock = mockStyleTransfer();
			return {
				...mock,
				outputKey: new URL(mock.outputUrl).pathname.replace(/^\//, ''),
				outputHash: ''
			};
		}
		generationFailed(
			'style-transfer',
			'Style transfer failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}
	if (!bucket) generationFailed('style-transfer', 'Style transfer failed', 'bucket not configured');

	let result: Awaited<ReturnType<typeof postStyleTransfer>>;
	try {
		result = await postStyleTransfer({
			client: requestClientFor(apiKey, apiUrl),
			signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
			body: {
				image: params.image,
				referenceImage: params.referenceImage,
				outputFormat: params.outputFormat,
				...(params.prompt ? { prompt: params.prompt } : {}),
				...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
				...(params.styleTransferStrength !== undefined
					? { styleTransferStrength: params.styleTransferStrength }
					: {})
			}
		});
	} catch (err) {
		generationFailed('style-transfer', 'Style transfer failed', err);
	}

	if (result.error) generationFailed('style-transfer', 'Style transfer failed', result.error);

	const data = result.data;
	if (!data) {
		generationFailed(
			'style-transfer',
			'Style transfer failed',
			'empty response from style service'
		);
	}

	const outputUrl = Array.isArray(data.output) ? data.output[0] : undefined;
	if (!outputUrl) {
		generationFailed(
			'style-transfer',
			'Style transfer failed',
			`no image URL in output: ${JSON.stringify(data.output)}`
		);
	}

	const output = await storeGeneratedImage(platform, bucket, outputUrl, 'style-transfer');
	return {
		outputKey: output.key,
		outputHash: output.hash,
		cost: data.cost,
		balance: data.balance
	};
}

export async function replaceTexturesWithMask(
	platform: App.Platform | undefined,
	bucket: Bucket | undefined,
	params: { image: string; referenceImage: string; mask: string }
): Promise<StoredRenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) {
			const mock = mockMaskedTextureReplacement();
			return {
				...mock,
				outputKey: new URL(mock.outputUrl).pathname.replace(/^\//, ''),
				outputHash: ''
			};
		}
		generationFailed(
			'change-textures',
			'Texture replacement failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}
	if (!bucket) {
		generationFailed('change-textures', 'Texture replacement failed', 'bucket not configured');
	}

	return processRenderResult(
		'change-textures',
		'Texture replacement failed',
		platform,
		bucket,
		() =>
			postChangeTextures({
				client: requestClientFor(apiKey, apiUrl),
				signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
				body: { image: params.image, referenceImage: params.referenceImage, mask: params.mask }
			})
	);
}

// Upscales the current render/edit result to 4K. `outputFormat` is optional —
// archAI defaults to jpg if omitted, mirroring the archAI API itself.
export async function upscale4k(
	platform: App.Platform | undefined,
	bucket: Bucket | undefined,
	params: { image: string; outputFormat?: OutputFormat }
): Promise<StoredRenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) {
			const mock = mockUpscale();
			return {
				...mock,
				outputKey: new URL(mock.outputUrl).pathname.replace(/^\//, ''),
				outputHash: ''
			};
		}
		generationFailed(
			'upscale-4k',
			'Upscale failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}
	if (!bucket) generationFailed('upscale-4k', 'Upscale failed', 'bucket not configured');

	return processRenderResult('upscale-4k', 'Upscale failed', platform, bucket, () =>
		postUpscale4K({
			client: requestClientFor(apiKey, apiUrl),
			signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
			body: {
				image: params.image,
				...(params.outputFormat ? { outputFormat: params.outputFormat } : {})
			}
		})
	);
}
