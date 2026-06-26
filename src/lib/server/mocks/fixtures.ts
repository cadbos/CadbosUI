// Dev-only fixtures in the exact shape of the API contract. They let the UI be
// built against the real wire types before the integrations land (phase C),
// where every endpoint below is replaced by a real server-only module.

import type { RenderResponse, UploadResult } from '$lib/api/contract';

export function mockUpload(): UploadResult {
	return {
		url: 'https://example.ufs.sh/f/dev-mock-image',
		mime: 'image/webp',
		size: 1024,
		dimensions: [1024, 768]
	};
}

export function mockRender(): RenderResponse {
	return {
		outputUrl: 'https://example.com/dev-mock-render.webp',
		cost: 1,
		balance: 99
	};
}
