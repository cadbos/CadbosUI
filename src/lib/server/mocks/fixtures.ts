// Dev-only fixtures in the exact shape of the API contract. They let the UI be
// built against the real wire types before the integrations land (phase C),
// where every endpoint below is replaced by a real server-only module.
//
// Demo branch: URLs point to real Unsplash-licensed photos so the UI looks
// convincing without requiring live external services.

import type { RenderResponse, UploadResult } from '$lib/api/contract';

export function mockUpload(): UploadResult {
	return {
		// Original room photo — Unsplash free (no attribution required for demo)
		url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&q=80',
		mime: 'image/jpeg',
		size: 342_000,
		dimensions: [1200, 800]
	};
}

export function mockRender(): RenderResponse {
	return {
		// Scandinavian interior render — Unsplash free
		outputUrl: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1200&q=80',
		cost: 2,
		balance: 48
	};
}

export function mockEdit(): RenderResponse {
	return {
		// Different colour scheme after edit — Unsplash free
		outputUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&q=80',
		cost: 2,
		balance: 46
	};
}
