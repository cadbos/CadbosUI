import { dev } from '$app/environment';
import { createClient } from '$lib/server/archai/client';
import { postRenderInterior } from '$lib/server/archai';
import type { RenderResponse, OutputFormat } from '$lib/api/contract';
import { mockRender } from '$lib/server/mocks/fixtures';

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
		body: {
			image: params.image,
			outputFormat: params.outputFormat,
			// Omit empty prompt — API treats its absence as Enhance mode.
			...(params.prompt ? { prompt: params.prompt } : {})
		}
	});

	if (result.error) {
		const err = result.error as { error?: string; message?: string };
		throw new Error(err.error ?? err.message ?? 'Render failed');
	}

	const data = result.data;
	if (!data) throw new Error('Empty response from render service');

	const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
	if (!outputUrl) {
		throw new Error(`Render returned no image URL (output: ${JSON.stringify(data.output)})`);
	}

	return { outputUrl, cost: data.cost, balance: data.balance };
}
