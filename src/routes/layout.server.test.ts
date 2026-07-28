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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const integration = vi.hoisted(() => ({ available: vi.fn() }));

vi.mock('$lib/server/comfyui', () => ({
	customWorkflowsAvailable: integration.available
}));

const { load } = await import('./+layout.server');

type LoadEvent = Parameters<typeof load>[0];

function event(): LoadEvent {
	return {
		platform: undefined,
		request: new Request('https://cadbos.example/create/interior')
	} as LoadEvent;
}

beforeEach(() => {
	integration.available.mockReset();
});

describe('root server layout', () => {
	it.each([true, false])(
		'serializes only the generic workflow capability flag',
		async (available) => {
			integration.available.mockResolvedValue(available);

			await expect(load(event())).resolves.toEqual({
				customWorkflowsAvailable: available
			});
			expect(integration.available).toHaveBeenCalledWith(undefined);
		}
	);
});
