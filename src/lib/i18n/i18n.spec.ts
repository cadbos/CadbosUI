import { describe, it, expect } from 'vitest';
import { t, getLocale, defaultLocale, locales } from './index.svelte';
import { ru } from './locales/ru';
import { en } from './locales/en';

describe('i18n', () => {
	it('defaults to Russian', () => {
		expect(defaultLocale).toBe('ru');
		expect(getLocale()).toBe('ru');
	});

	it('translates a key in the default locale', () => {
		expect(t('view.chat')).toBe(ru['view.chat']);
	});

	it('exposes exactly the supported locales', () => {
		expect([...locales]).toEqual(['ru', 'en']);
	});

	it('defines the same keys in every locale', () => {
		const expected = Object.keys(ru).sort();
		expect(Object.keys(en).sort()).toEqual(expected);
	});
});
