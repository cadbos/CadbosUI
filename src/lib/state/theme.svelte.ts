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
import { logBoundaryError } from '$lib/utils';

const STORAGE_KEY = 'cadbos.theme.v1';

export type ThemeMode = 'light' | 'dark' | 'system';

interface StoredTheme {
	mode: ThemeMode;
}

function isThemeMode(value: unknown): value is ThemeMode {
	return value === 'light' || value === 'dark' || value === 'system';
}

function isStoredTheme(value: unknown): value is StoredTheme {
	if (typeof value !== 'object' || value === null) return false;
	return isThemeMode((value as Partial<StoredTheme>).mode);
}

function readStoredState(): StoredTheme | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isStoredTheme(parsed)) return null;
		return parsed;
	} catch (error) {
		logBoundaryError('theme.restore', error);
		return null;
	}
}

class ThemeState {
	mode = $state<ThemeMode>('system');
	#hydrated = false;

	// Deliberately not read in the constructor: this store is a client+server
	// module-level singleton, so restoring localStorage there would make the
	// very first client render (the one hydration diffs against the
	// server-rendered HTML) already reflect a stored mode the server never
	// rendered. Called once from a consuming component's mount effect
	// instead, so it only ever runs after hydration has settled. The inline
	// script in src/app.html pre-sets data-theme synchronously before
	// hydration to avoid a flash of the wrong theme; re-applying the same
	// attribute here just hands ownership of it to this reactive store for
	// subsequent changes.
	hydrate(): void {
		if (this.#hydrated) return;
		this.#hydrated = true;
		const stored = readStoredState();
		if (stored) {
			this.mode = stored.mode;
		}
		this.#syncDom();
	}

	setMode(next: ThemeMode): void {
		this.mode = next;
		this.#syncDom();
		this.#persist();
	}

	#syncDom(): void {
		if (!browser) return;
		if (this.mode === 'system') {
			delete document.documentElement.dataset.theme;
		} else {
			document.documentElement.dataset.theme = this.mode;
		}
	}

	#persist(): void {
		if (!browser) return;
		try {
			const payload: StoredTheme = { mode: this.mode };
			localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
		} catch (error) {
			logBoundaryError('theme.persist', error);
		}
	}
}

export const theme = new ThemeState();
