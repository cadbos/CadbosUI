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
import type { DepositResponse, PackageRecord, PackagesResponse } from '$lib/api/contract';

const authMock = vi.hoisted(() => ({
	refreshCredit: vi.fn()
}));
vi.mock('$lib/state/auth.svelte', () => ({ auth: authMock }));

const { deposits } = await import('./deposits.svelte');

function pkg(id: string): PackageRecord {
	return { id, usdAmount: 10, creditsAwarded: 100 };
}

function deposit(overrides: Partial<DepositResponse> = {}): DepositResponse {
	return {
		id: 'deposit-1',
		status: 'pending',
		bolt11: 'lnbc1...',
		satsAmount: 25000,
		usdAmount: 10,
		expiresAt: Date.now() + 600_000,
		...overrides
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	deposits.reset();
	authMock.refreshCredit.mockClear();
});

afterEach(() => {
	deposits.reset();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('loadPackages', () => {
	it('populates packages on success', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		const body: PackagesResponse = { packages: [pkg('pkg-1')] };
		fetchMock.mockResolvedValueOnce(jsonResponse(body));

		await deposits.loadPackages();

		expect(fetchMock).toHaveBeenCalledWith('/api/packages');
		expect(deposits.packagesStatus).toBe('ready');
		expect(deposits.packages).toEqual([pkg('pkg-1')]);
	});

	it('handles an empty package list', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse({ packages: [] }));

		await deposits.loadPackages();

		expect(deposits.packagesStatus).toBe('ready');
		expect(deposits.packages).toEqual([]);
	});

	it('sets an error status on a failed request', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));

		await deposits.loadPackages();

		expect(deposits.packagesStatus).toBe('error');
		expect(deposits.packagesError).toBe('DepositLoadError');
		expect(deposits.packages).toEqual([]);
	});
});

describe('createDeposit', () => {
	it('stores the deposit and starts polling on success', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse(deposit()));

		await deposits.createDeposit('pkg-1');

		expect(fetchMock).toHaveBeenCalledWith('/api/deposits', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ packageId: 'pkg-1' })
		});
		expect(deposits.depositStatus).toBe('polling');
		expect(deposits.activeDeposit).toEqual(deposit());

		fetchMock.mockResolvedValueOnce(jsonResponse(deposit()));
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/deposits/deposit-1');
	});

	it('sets a distinguishable error on a 429 response', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));

		await deposits.createDeposit('pkg-1');

		expect(deposits.depositStatus).toBe('error');
		expect(deposits.depositError).toBe('rate_limited');
	});

	it('sets a generic error on other failures', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));

		await deposits.createDeposit('pkg-1');

		expect(deposits.depositStatus).toBe('error');
		expect(deposits.depositError).toBe('create_failed');
	});
});

describe('polling', () => {
	it('stops polling and refreshes credit exactly once when status becomes paid', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse(deposit()));

		await deposits.createDeposit('pkg-1');

		fetchMock.mockResolvedValueOnce(jsonResponse(deposit({ status: 'paid', balance: 150 })));
		await vi.advanceTimersByTimeAsync(2000);

		expect(deposits.depositStatus).toBe('paid');
		expect(deposits.activeDeposit?.balance).toBe(150);
		expect(authMock.refreshCredit).toHaveBeenCalledTimes(1);

		const callsBefore = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetchMock.mock.calls.length).toBe(callsBefore);
		expect(authMock.refreshCredit).toHaveBeenCalledTimes(1);
	});

	it('maps expired and failed statuses to the expired UI state and stops polling', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse(deposit()));

		await deposits.createDeposit('pkg-1');

		fetchMock.mockResolvedValueOnce(jsonResponse(deposit({ status: 'failed' })));
		await vi.advanceTimersByTimeAsync(2000);

		expect(deposits.depositStatus).toBe('expired');

		const callsBefore = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetchMock.mock.calls.length).toBe(callsBefore);
	});

	it('logs and keeps polling when a single poll request throws', async () => {
		vi.useFakeTimers();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse(deposit()));

		await deposits.createDeposit('pkg-1');

		fetchMock.mockRejectedValueOnce(new Error('network blip'));
		await vi.advanceTimersByTimeAsync(2000);

		expect(deposits.depositStatus).toBe('polling');
		expect(deposits.depositError).toBeNull();
		expect(consoleError).toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce(jsonResponse(deposit({ status: 'paid', balance: 200 })));
		await vi.advanceTimersByTimeAsync(2000);

		expect(deposits.depositStatus).toBe('paid');
		consoleError.mockRestore();
	});
});

describe('reset', () => {
	it('clears state and stops any active poll timer', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValueOnce(jsonResponse(deposit()));

		await deposits.createDeposit('pkg-1');
		expect(deposits.depositStatus).toBe('polling');

		deposits.reset();

		expect(deposits.activeDeposit).toBeNull();
		expect(deposits.depositStatus).toBe('idle');
		expect(deposits.depositError).toBeNull();

		const callsBefore = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetchMock.mock.calls.length).toBe(callsBefore);
	});
});
