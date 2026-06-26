import { browser } from '$app/environment';
import { ru } from '$lib/i18n/locales/ru';
import { en } from '$lib/i18n/locales/en';

export type Locale = 'ru' | 'en';
export type TranslationKey = keyof typeof ru;
export type Dictionary = Record<TranslationKey, string>;

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
