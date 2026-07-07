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

import type { ImageInput, PromptFragment, RequestJSON } from '$lib/state/request.svelte';
import { request } from '$lib/state/request.svelte';

export const AC9_REQUEST_ID = 'ac9-request-0001';

export const AC9_FRAGMENT_IDS = ['ac9-frag-01', 'ac9-frag-02', 'ac9-frag-03'] as const;

export const AC9_IMAGE: ImageInput = {
	url: 'https://example.ufs.sh/f/ac9-fixture-room',
	mime: 'image/webp',
	size: 2048,
	dimensions: [1024, 768]
};

export const AC9_FRAGMENTS: PromptFragment[] = [
	{ id: AC9_FRAGMENT_IDS[0], label: 'Style', text: 'Scandinavian ', order: 0 },
	{ id: AC9_FRAGMENT_IDS[1], label: 'Room', text: 'living room, ', order: 1 },
	{ id: AC9_FRAGMENT_IDS[2], label: 'Lighting', text: 'warm light', order: 2 }
];

export const AC9_PROMPT = 'Style: Scandinavian\nRoom: living room,\nLighting: warm light';

export const AC9_RENDER_REQUEST = {
	image: AC9_IMAGE.url,
	prompt: AC9_PROMPT,
	outputFormat: 'webp' as const
};

export function buildAc9RequestJSON(): RequestJSON {
	return {
		id: AC9_REQUEST_ID,
		image: {
			url: AC9_IMAGE.url,
			mime: AC9_IMAGE.mime,
			size: AC9_IMAGE.size,
			...(AC9_IMAGE.dimensions ? { dimensions: [...AC9_IMAGE.dimensions] } : {})
		},
		promptFragments: AC9_FRAGMENTS.map((fragment) => ({
			id: fragment.id,
			...(fragment.label !== undefined ? { label: fragment.label } : {}),
			text: fragment.text,
			order: fragment.order
		})),
		outputFormat: 'webp',
		sceneType: 'interior',
		promptOverride: null,
		status: 'idle'
	};
}

export function applyAc9Fixture(): void {
	request.fromJSON(buildAc9RequestJSON());
}
