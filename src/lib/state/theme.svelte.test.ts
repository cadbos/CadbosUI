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

import { beforeEach, describe, expect, it } from 'vitest';

const STORAGE_KEY = 'cadbos.theme.v1';

type ThemeSingleton = typeof import('./theme.svelte').theme;

// hydrate() is idempotent per instance by design (see theme.svelte.ts), so
// re-hydrating the shared module-level singleton across tests would only
// ever read localStorage on the first call. Cache-busting the import
// specifier forces a fresh ThemeState instance — and a fresh #hydrated
// flag — for every test that needs to exercise hydrate() against a
// different stored payload.
let importCount = 0;
async function freshTheme(): Promise<ThemeSingleton> {
	importCount += 1;
	const module = await import(/* @vite-ignore */ `./theme.svelte.ts?test=${importCount}`);
	return module.theme;
}

describe('theme store', () => {
	beforeEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.theme;
	});

	it('defaults to system with no data-theme attribute when nothing is stored', async () => {
		const theme = await freshTheme();
		theme.hydrate();
		expect(theme.mode).toBe('system');
		expect(document.documentElement.dataset.theme).toBeUndefined();
	});

	it('hydrate() restores a previously persisted mode and applies it to the DOM', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'dark' }));
		const theme = await freshTheme();
		theme.hydrate();
		expect(theme.mode).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
	});

	it('ignores malformed JSON in storage and falls back to system', async () => {
		localStorage.setItem(STORAGE_KEY, '{not json');
		const theme = await freshTheme();
		expect(() => theme.hydrate()).not.toThrow();
		expect(theme.mode).toBe('system');
	});

	it('ignores a stored payload whose mode is not a recognized literal', async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'purple' }));
		const theme = await freshTheme();
		theme.hydrate();
		expect(theme.mode).toBe('system');
	});

	it('setMode() persists the new mode for a later hydrate() to restore', async () => {
		const writer = await freshTheme();
		writer.setMode('dark');

		const reader = await freshTheme();
		reader.hydrate();
		expect(reader.mode).toBe('dark');
	});

	it('setMode() syncs data-theme: set for light/dark, removed for system', async () => {
		const theme = await freshTheme();

		theme.setMode('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');

		theme.setMode('light');
		expect(document.documentElement.dataset.theme).toBe('light');

		theme.setMode('system');
		expect(document.documentElement.dataset.theme).toBeUndefined();
	});
});
