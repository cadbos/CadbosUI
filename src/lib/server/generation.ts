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
import { postRenderInterior } from '$lib/server/archai';
import type { RenderResponse, OutputFormat } from '$lib/api/contract';
import { mockRender } from '$lib/server/mocks/fixtures';

// И-MA-6: default sync-call timeout, configurable.
const RENDER_TIMEOUT_MS = 120_000;

// Provider error details (raw response text, internal ids) must stay server-side
// (NFR-6/8) — log them here and surface only a generic message to the caller,
// which the route handler passes straight through to the client.
function renderFailed(detail: unknown): never {
	console.error('archAI render/interior failed:', detail);
	throw new Error('Render failed');
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

	// Per-request client — setting headers on the singleton is not safe in Workers.
	const requestClient = createClient({
		baseUrl: 'https://api.myarchitectai.com/v1',
		headers: { 'x-api-key': apiKey }
	});

	const result = await postRenderInterior({
		client: requestClient,
		signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
		body: {
			image: params.image,
			outputFormat: params.outputFormat,
			// Omit empty prompt — API treats its absence as Enhance mode.
			...(params.prompt ? { prompt: params.prompt } : {})
		}
	});

	if (result.error) renderFailed(result.error);

	const data = result.data;
	if (!data) renderFailed('empty response from render service');

	const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
	if (!outputUrl) renderFailed(`no image URL in output: ${JSON.stringify(data.output)}`);

	return { outputUrl, cost: data.cost, balance: data.balance };
}
