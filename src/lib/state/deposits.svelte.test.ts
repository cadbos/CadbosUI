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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ refreshCredit: vi.fn() }));
vi.mock('$lib/state/auth.svelte', () => ({ auth }));

const { DepositsState } = await import('./deposits.svelte');

function json(body: unknown, init: ResponseInit = {}): Response {
	return Response.json(body, init);
}

beforeEach(() => {
	localStorage.clear();
	auth.refreshCredit.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('deposit client recovery', () => {
	it('resumes a stored request after reload and refreshes credit on settlement', async () => {
		const requestId = crypto.randomUUID();
		const depositId = crypto.randomUUID();
		localStorage.setItem(
			'cadbos.deposit.owner-1',
			JSON.stringify({ requestId, packageId: 'pkg-1', depositId })
		);
		const fetcher = vi.fn<typeof fetch>(async (input) => {
			const url = String(input);
			if (url === '/api/packages') {
				return json({ packages: [{ id: 'pkg-1', usdAmount: 1, creditsAwarded: 3 }] });
			}
			if (url === `/api/deposits/${depositId}`) {
				return json({ id: depositId, status: 'paid', usdAmount: 1, balance: 3 });
			}
			return new Response(null, { status: 404 });
		});
		vi.stubGlobal('fetch', fetcher);
		const state = new DepositsState();

		state.activate('owner-1');

		await vi.waitFor(() => expect(state.deposit?.status).toBe('paid'));
		expect(state.selectedPackageId).toBe('pkg-1');
		expect(auth.refreshCredit).toHaveBeenCalledOnce();
		state.deactivate();
	});

	it('ignores stale package responses after the active owner changes', async () => {
		let resolveFirst: (response: Response) => void = () => undefined;
		const first = new Promise<Response>((resolve) => {
			resolveFirst = resolve;
		});
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(() => first)
			.mockResolvedValueOnce(
				json({ packages: [{ id: 'pkg-new', usdAmount: 5, creditsAwarded: 15 }] })
			);
		vi.stubGlobal('fetch', fetcher);
		const state = new DepositsState();

		state.activate('owner-1');
		state.activate('owner-2');
		resolveFirst(json({ packages: [{ id: 'pkg-stale', usdAmount: 1, creditsAwarded: 3 }] }));

		await vi.waitFor(() => expect(state.packagesStatus).toBe('ready'));
		expect(state.packages.map((item) => item.id)).toEqual(['pkg-new']);
		state.deactivate();
	});
});
