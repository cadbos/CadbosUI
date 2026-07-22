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
	postEditByPrompt,
	postRenderExterior,
	postRenderInterior,
	postStyleTransfer,
	postUpscale4K
} from '$lib/server/archai';
import type { ArrayGenerationResponse, SingleGenerationResponse } from '$lib/server/archai';
import type { RenderResponse, OutputFormat } from '$lib/api/contract';
import { imageExtensionFromMime } from '$lib/server/image-utils';
import {
	mockEdit,
	mockRender,
	mockRenderExterior,
	mockStyleTransfer,
	mockUpscale
} from '$lib/server/mocks/fixtures';
import { uploadImageBytes } from '$lib/server/uploads';

// И-MA-6 / И-MA-ED3: default sync-call timeout, shared by render and edit.
const RENDER_TIMEOUT_MS = 120_000;
const GENERATED_IMAGE_FETCH_TIMEOUT_MS = 60_000;

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

async function storeGeneratedImage(
	platform: App.Platform | undefined,
	imageUrl: string,
	operation: string
): Promise<string> {
	let response: Response;
	try {
		response = await fetch(imageUrl, {
			signal: AbortSignal.timeout(GENERATED_IMAGE_FETCH_TIMEOUT_MS)
		});
	} catch (err) {
		console.error(
			`archAI ${operation} image mirror failed after successful generation:`,
			`download fetch failed (${caughtErrorKind(err)})`
		);
		return imageUrl;
	}

	if (!response.ok) {
		console.error(
			`archAI ${operation} image mirror failed after successful generation:`,
			`unexpected download status ${response.status}`
		);
		return imageUrl;
	}

	const contentType = response.headers.get('content-type') ?? '';
	if (imageExtensionFromMime(contentType) === null) {
		console.error(
			`archAI ${operation} image mirror failed after successful generation:`,
			`unexpected content type ${contentType || '(missing)'}`
		);
		return imageUrl;
	}

	let bytes: ArrayBuffer;
	try {
		bytes = await response.arrayBuffer();
	} catch (err) {
		console.error(
			`archAI ${operation} image mirror failed after successful generation:`,
			`download body read failed (${caughtErrorKind(err)})`
		);
		return imageUrl;
	}

	if (bytes.byteLength === 0) {
		console.error(
			`archAI ${operation} image mirror failed after successful generation:`,
			'empty image response'
		);
		return imageUrl;
	}

	try {
		const stored = await uploadImageBytes(platform, bytes, contentType);
		return stored.url;
	} catch (err) {
		console.error(
			`archAI ${operation} image mirror failed after successful generation:`,
			`storage upload failed (${caughtErrorKind(err)})`
		);
		return imageUrl;
	}
}

// Shared by renderInterior/renderExterior/upscale4k: all three call an archAI
// endpoint that returns either a single output URL or an array of them, and
// all fail the same way (network error, provider error, empty/missing output).
async function processRenderResult(
	operation: string,
	clientMessage: string,
	platform: App.Platform | undefined,
	call: () => Promise<{
		data?: ArrayGenerationResponse | SingleGenerationResponse;
		error?: unknown;
	}>
): Promise<RenderResponse> {
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

	return {
		outputUrl: await storeGeneratedImage(platform, outputUrl, operation),
		cost: data.cost,
		balance: data.balance
	};
}

export async function renderInterior(
	platform: App.Platform | undefined,
	params: { image: string; prompt: string; outputFormat: OutputFormat }
): Promise<RenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) return mockRender();
		generationFailed(
			'render/interior',
			'Render failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}

	return processRenderResult('render/interior', 'Render failed', platform, () =>
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

// Post-MVP addition (docs/tz.md §8.2.2 lists render/exterior as out of the
// documented MVP scope) — same request/response shape as renderInterior,
// just a different archAI endpoint/model.
export async function renderExterior(
	platform: App.Platform | undefined,
	params: { image: string; prompt: string; outputFormat: OutputFormat }
): Promise<RenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) return mockRenderExterior();
		generationFailed(
			'render/exterior',
			'Render failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}

	return processRenderResult('render/exterior', 'Render failed', platform, () =>
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

// Д-17: `image` is the URL of the render being edited (the caller passes
// currentRender.outputUrls[0] for iterative edits). No outputFormat — aspect
// ratio is preserved automatically (И-MA-ED1).
export async function editInterior(
	platform: App.Platform | undefined,
	params: { image: string; prompt: string }
): Promise<RenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) return mockEdit();
		generationFailed(
			'edit-by-prompt',
			'Edit failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}

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

	return {
		outputUrl: await storeGeneratedImage(platform, data.output, 'edit-by-prompt'),
		cost: data.cost,
		balance: data.balance
	};
}

export async function styleTransferInterior(
	platform: App.Platform | undefined,
	params: {
		image: string;
		referenceImage: string;
		outputFormat: OutputFormat;
		prompt?: string | undefined;
		negativePrompt?: string | undefined;
		styleTransferStrength?: number | undefined;
	}
): Promise<RenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) return mockStyleTransfer();
		generationFailed(
			'style-transfer',
			'Style transfer failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}

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

	return {
		outputUrl: await storeGeneratedImage(platform, outputUrl, 'style-transfer'),
		cost: data.cost,
		balance: data.balance
	};
}

// Upscales the current render/edit result to 4K. `outputFormat` is optional —
// archAI defaults to jpg if omitted, mirroring the archAI API itself.
export async function upscale4k(
	platform: App.Platform | undefined,
	params: { image: string; outputFormat?: OutputFormat }
): Promise<RenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;
	const apiUrl = platform?.env?.ARCHAI_API_URL;

	if (!apiKey || !apiUrl) {
		if (dev) return mockUpscale();
		generationFailed(
			'upscale-4k',
			'Upscale failed',
			`${!apiKey ? 'ARCHAI_API_KEY' : 'ARCHAI_API_URL'} not configured`
		);
	}

	return processRenderResult('upscale-4k', 'Upscale failed', platform, () =>
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
