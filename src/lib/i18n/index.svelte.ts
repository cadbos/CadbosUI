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
import { ru } from '$lib/i18n/locales/ru';
import { en } from '$lib/i18n/locales/en';
import type { Dictionary } from '$lib/i18n/locales';
import { logBoundaryError } from '$lib/utils';

export type Locale = 'ru' | 'en';
export type TranslationKey = keyof Dictionary;

export const defaultLocale: Locale = 'ru';
export const locales: readonly Locale[] = ['ru', 'en'];

const dictionaries: Record<Locale, Dictionary> = { ru, en };

const STORAGE_KEY = 'cadbos.locale.v1';

function isLocale(value: unknown): value is Locale {
	return value === 'ru' || value === 'en';
}

let locale = $state<Locale>(defaultLocale);
let hydrated = false;

export function getLocale(): Locale {
	return locale;
}

export function setLocale(next: Locale): void {
	// Locale is only switched in the browser; the server renders the default
	// locale to avoid leaking state across requests.
	if (!browser) return;
	locale = next;
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch (error) {
		logBoundaryError('i18n.setLocale', error);
	}
}

// Restores a previously chosen locale from localStorage. Deliberately not
// read at module init: this store is a client+server singleton, so applying
// the stored locale there would make the very first client render (the one
// hydration diffs against the server-rendered HTML) reflect a locale the
// server never rendered. Call once from the root layout's mount effect
// instead, after hydration has settled — mirrors ToolsPanelState.hydrate().
export function hydrateLocale(): void {
	if (hydrated || !browser) return;
	hydrated = true;
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (isLocale(stored)) locale = stored;
	} catch (error) {
		logBoundaryError('i18n.hydrateLocale', error);
	}
}

export function t(key: TranslationKey): string {
	return dictionaries[locale][key] ?? dictionaries[defaultLocale][key];
}

export function ti(key: TranslationKey, params: Record<string, string | number>): string {
	return t(key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
}
