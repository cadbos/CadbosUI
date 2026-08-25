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

import { browser } from '$app/environment';
import { exchangeRateSchema } from '$lib/api/contract';
import { formatCredit, logBoundaryError } from '$lib/utils';

const STORAGE_KEY = 'cadbos.currency.v1';

export type CurrencyCode = 'usd' | 'rub';

const SYMBOLS: Record<CurrencyCode, string> = { usd: '$', rub: '₽' };

function isCurrencyCode(value: unknown): value is CurrencyCode {
	return value === 'usd' || value === 'rub';
}

function readStoredCode(): CurrencyCode | null {
	if (!browser) return null;
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return isCurrencyCode(stored) ? stored : null;
	} catch (error) {
		logBoundaryError('currency.restore', error);
		return null;
	}
}

class CurrencyState {
	code = $state<CurrencyCode>('usd');
	rubPerUsd = $state<number | null>(null);
	#hydrated = false;

	// Falls back to USD whenever the RUB rate hasn't loaded yet (or failed to
	// load) — better to show a value the user can trust than a wrong number
	// mislabeled as rubles.
	get displayCode(): CurrencyCode {
		return this.code === 'rub' && this.rubPerUsd !== null ? 'rub' : 'usd';
	}

	get symbol(): string {
		return SYMBOLS[this.displayCode];
	}

	// Deliberately not read in the constructor: this store is a client+server
	// module-level singleton, so restoring localStorage there would make the
	// very first client render (the one hydration diffs against the
	// server-rendered HTML) already reflect a stored code the server never
	// rendered. Called once from the root layout's mount effect instead, so
	// it only ever runs after hydration has settled — mirrors theme.svelte.ts.
	hydrate(): void {
		if (this.#hydrated) return;
		this.#hydrated = true;
		const stored = readStoredCode();
		if (stored) this.code = stored;
		void this.#loadRate();
	}

	setCode(next: CurrencyCode): void {
		this.code = next;
		this.#persist();
	}

	// Formats a USD amount for display in the currently selected currency,
	// including the symbol — callers never hardcode "$"/"₽" themselves.
	format(amountUsd: number): string {
		const rate = this.rubPerUsd;
		const amount = this.displayCode === 'rub' && rate !== null ? amountUsd * rate : amountUsd;
		return `${formatCredit(amount)} ${this.symbol}`;
	}

	#persist(): void {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, this.code);
		} catch (error) {
			logBoundaryError('currency.persist', error);
		}
	}

	async #loadRate(): Promise<void> {
		try {
			const response = await fetch('/api/exchange-rate');
			if (!response.ok) throw new Error('exchange rate request failed');
			const parsed = exchangeRateSchema.safeParse(await response.json());
			if (!parsed.success) throw new Error('exchange rate response invalid');
			this.rubPerUsd = parsed.data.rubPerUsd;
		} catch (error) {
			logBoundaryError('currency.loadRate', error);
		}
	}
}

export const currency = new CurrencyState();
