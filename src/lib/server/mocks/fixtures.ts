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

export function mockRenderExterior(): RenderResponse {
	return {
		// Modern house facade render — Unsplash free
		outputUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',
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

export function mockStyleTransfer(): RenderResponse {
	return {
		outputUrl: 'https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?w=1200&q=80',
		cost: 2,
		balance: 44
	};
}

export function mockUpscale(): RenderResponse {
	return {
		// Same scene at a higher resolution — Unsplash free
		outputUrl: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=3840&q=90',
		cost: 3,
		balance: 43
	};
}
