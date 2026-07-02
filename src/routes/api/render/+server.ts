import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, parseBody, renderRequestSchema } from '$lib/server/api';
import { renderInterior } from '$lib/server/generation';

// Session is enforced centrally in hooks.server.ts (guardedPaths).
export const POST: RequestHandler = async ({ request, platform }) => {
	const parsed = await parseBody(request, renderRequestSchema);
	if (!parsed.ok) return parsed.response;

	try {
		const result = await renderInterior(platform, parsed.data);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Render failed';
		return apiError(500, 'render_failed', message);
	}
};
