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
import { postEditByPrompt, postRenderInterior } from '$lib/server/archai';
import type { RenderResponse, OutputFormat } from '$lib/api/contract';
import { mockEdit, mockRender } from '$lib/server/mocks/fixtures';

// И-MA-6 / И-MA-ED3: default sync-call timeout, shared by render and edit.
const RENDER_TIMEOUT_MS = 120_000;

// Provider error details (raw response text, internal ids) must stay server-side
// (NFR-6/8) — log them here and surface only a generic, operation-appropriate
// message to the caller, which the route handler passes straight through to the
// client.
function generationFailed(operation: string, clientMessage: string, detail: unknown): never {
	console.error(`archAI ${operation} failed:`, detail);
	throw new Error(clientMessage);
}

function requestClientFor(apiKey: string): ReturnType<typeof createClient> {
	// Per-request client — setting headers on the singleton is not safe in Workers.
	return createClient({
		baseUrl: 'https://api.myarchitectai.com/v1',
		headers: { 'x-api-key': apiKey }
	});
}

export async function renderInterior(
	platform: App.Platform | undefined,
	params: { image: string; prompt: string; outputFormat: OutputFormat }
): Promise<RenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;

	if (!apiKey) {
		if (dev) return mockRender();
		throw new Error('ARCHAI_API_KEY not configured');
	}

	const result = await postRenderInterior({
		client: requestClientFor(apiKey),
		signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
		body: {
			image: params.image,
			outputFormat: params.outputFormat,
			// Omit empty prompt — API treats its absence as Enhance mode.
			...(params.prompt ? { prompt: params.prompt } : {})
		}
	});

	if (result.error) generationFailed('render/interior', 'Render failed', result.error);

	const data = result.data;
	if (!data) {
		generationFailed('render/interior', 'Render failed', 'empty response from render service');
	}

	const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
	if (!outputUrl) {
		generationFailed(
			'render/interior',
			'Render failed',
			`no image URL in output: ${JSON.stringify(data.output)}`
		);
	}

	return { outputUrl, cost: data.cost, balance: data.balance };
}

// Д-17: `image` is the URL of the render being edited (the caller passes
// currentRender.outputUrls[0] for iterative edits). No outputFormat — aspect
// ratio is preserved automatically (И-MA-ED1).
export async function editInterior(
	platform: App.Platform | undefined,
	params: { image: string; prompt: string }
): Promise<RenderResponse> {
	const apiKey = platform?.env?.ARCHAI_API_KEY;

	if (!apiKey) {
		if (dev) return mockEdit();
		throw new Error('ARCHAI_API_KEY not configured');
	}

	const result = await postEditByPrompt({
		client: requestClientFor(apiKey),
		signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
		body: { image: params.image, prompt: params.prompt }
	});

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

	return { outputUrl: data.output, cost: data.cost, balance: data.balance };
}
