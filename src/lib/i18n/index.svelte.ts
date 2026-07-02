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

export type Locale = 'ru' | 'en';
export type TranslationKey = keyof Dictionary;

export const defaultLocale: Locale = 'ru';
export const locales: readonly Locale[] = ['ru', 'en'];

const dictionaries: Record<Locale, Dictionary> = { ru, en };

let locale = $state<Locale>(defaultLocale);

export function getLocale(): Locale {
	return locale;
}

export function setLocale(next: Locale): void {
	// Locale is only switched in the browser; the server renders the default
	// locale to avoid leaking state across requests.
	if (browser) locale = next;
}

export function t(key: TranslationKey): string {
	return dictionaries[locale][key] ?? dictionaries[defaultLocale][key];
}

export function ti(key: TranslationKey, params: Record<string, string | number>): string {
	return t(key).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
}
