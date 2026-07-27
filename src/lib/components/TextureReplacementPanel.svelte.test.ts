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

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { setLocale } from '$lib/i18n/index.svelte';
import { auth } from '$lib/state/auth.svelte';
import { request } from '$lib/state/request.svelte';
import TextureReplacementPanel from './TextureReplacementPanel.svelte';

// Simulates a poll response whose headers arrive (fetch() resolves) but whose
// body never completes: json() only settles once the request's AbortSignal
// fires, mirroring how a real stalled connection behaves once its controlling
// signal is aborted.
function stalledJsonResponse(signal: AbortSignal): Response {
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		json: () =>
			new Promise((_resolve, reject) => {
				signal.addEventListener(
					'abort',
					() => reject(new DOMException('The operation was aborted.', 'AbortError')),
					{ once: true }
				);
			})
	} as unknown as Response;
}

function processingResponse(jobId: string): Response {
	return new Response(JSON.stringify({ id: jobId, status: 'processing' }), {
		status: 200,
		headers: { 'content-type': 'application/json', 'retry-after': '30' }
	});
}

beforeEach(() => {
	setLocale('en');
	request.reset();
	auth.status = 'authenticated';
});

afterEach(() => {
	request.reset();
	auth.status = 'anonymous';
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it('retries a poll whose body stalls past the per-request timeout instead of failing immediately', async () => {
	const jobId = crypto.randomUUID();
	const fetchMock = vi.fn<typeof fetch>();
	const timeoutControllers: AbortController[] = [];
	vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
		const controller = new AbortController();
		timeoutControllers.push(controller);
		return controller.signal;
	});

	fetchMock.mockImplementationOnce((_url, init) => {
		const signal = (init as RequestInit).signal as AbortSignal;
		return Promise.resolve(stalledJsonResponse(signal));
	});
	fetchMock.mockImplementationOnce(() => Promise.resolve(processingResponse(jobId)));
	vi.stubGlobal('fetch', fetchMock);

	request.setActiveTextureReplacementJobId(jobId);
	const screen = render(TextureReplacementPanel);

	await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

	// Simulate the per-request AbortSignal.timeout firing while the body is
	// still stalled — this is what previously surfaced as a terminal
	// pollFailure instead of a transient retry.
	timeoutControllers[0]?.abort();

	await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 5_000 });

	await expect
		.element(screen.getByRole('status').filter({ hasText: /Replacing the texture/ }))
		.toHaveTextContent(/Replacing the texture/);
	expect(document.querySelector('.submit-error')).toBeNull();
});
