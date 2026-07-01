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

import { describe, it, expect } from 'vitest';
import { t, getLocale, defaultLocale, locales } from '$lib/i18n/index.svelte';
import { ru } from '$lib/i18n/locales/ru';
import { en } from '$lib/i18n/locales/en';

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
