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

const STORAGE_KEY = 'cadbos.currency.v1';

type CurrencySingleton = typeof import('./currency.svelte').currency;

// hydrate() is idempotent per instance by design (see currency.svelte.ts), so
// re-hydrating the shared module-level singleton across tests would only
// ever read localStorage/fetch on the first call. Cache-busting the import
// specifier forces a fresh CurrencyState instance — and a fresh #hydrated
// flag — for every test that needs to exercise hydrate() against a
// different stored payload or fetch outcome.
let importCount = 0;
async function freshCurrency(): Promise<CurrencySingleton> {
	importCount += 1;
	const module = await import(/* @vite-ignore */ `./currency.svelte.ts?test=${importCount}`);
	return module.currency;
}

describe('currency store', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('defaults to usd with no rate loaded when nothing is stored and hydrate() has not run', async () => {
		const currency = await freshCurrency();
		expect(currency.code).toBe('usd');
		expect(currency.rubPerUsd).toBeNull();
		expect(currency.displayCode).toBe('usd');
		expect(currency.symbol).toBe('$');
	});

	it('hydrate() restores a previously persisted code from localStorage', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new Error('network unavailable')))
		);
		localStorage.setItem(STORAGE_KEY, 'rub');
		const currency = await freshCurrency();
		currency.hydrate();
		expect(currency.code).toBe('rub');
	});

	it('ignores a garbage stored value and falls back to usd', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new Error('network unavailable')))
		);
		localStorage.setItem(STORAGE_KEY, 'eur');
		const currency = await freshCurrency();
		currency.hydrate();
		expect(currency.code).toBe('usd');
	});

	it('setCode() persists the new code for a later hydrate() to restore', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new Error('network unavailable')))
		);
		const writer = await freshCurrency();
		writer.setCode('rub');

		const reader = await freshCurrency();
		reader.hydrate();
		expect(reader.code).toBe('rub');
	});

	describe('format()', () => {
		it('formats in USD when code is usd', async () => {
			const currency = await freshCurrency();
			expect(currency.format(10)).toBe('10.00 $');
		});

		it('falls back to USD when code is rub but the rate has not loaded', async () => {
			const currency = await freshCurrency();
			currency.setCode('rub');
			expect(currency.rubPerUsd).toBeNull();
			expect(currency.format(10)).toBe('10.00 $');
		});

		it('converts to RUB using rubPerUsd once the rate is set', async () => {
			const currency = await freshCurrency();
			currency.setCode('rub');
			currency.rubPerUsd = 90;
			expect(currency.format(10)).toBe('900.00 ₽');
		});
	});

	describe('hydrate() rate loading', () => {
		it('populates rubPerUsd from a valid /api/exchange-rate response', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(() =>
					Promise.resolve(
						new Response(JSON.stringify({ rubPerUsd: 92.5, asOf: new Date().toISOString() }), {
							status: 200,
							headers: { 'content-type': 'application/json' }
						})
					)
				)
			);
			const currency = await freshCurrency();
			currency.hydrate();
			await vi.waitFor(() => expect(currency.rubPerUsd).toBe(92.5));
		});

		it('leaves rubPerUsd null and does not throw on a failed response', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(() => Promise.resolve(new Response('', { status: 500 })))
			);
			const currency = await freshCurrency();
			expect(() => currency.hydrate()).not.toThrow();
			await vi.waitFor(() => expect(currency.rubPerUsd).toBeNull());
		});

		it('leaves rubPerUsd null and does not throw on an invalid response body', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(() =>
					Promise.resolve(
						new Response(JSON.stringify({ rubPerUsd: -1, asOf: 'not-a-date' }), {
							status: 200,
							headers: { 'content-type': 'application/json' }
						})
					)
				)
			);
			const currency = await freshCurrency();
			expect(() => currency.hydrate()).not.toThrow();
			await vi.waitFor(() => expect(currency.rubPerUsd).toBeNull());
		});
	});
});
