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

import type { MediaAccess } from '$lib/api/contract';

export class MediaAccessState {
	entries = $state<Record<string, MediaAccess>>({});

	normalize(access: MediaAccess): MediaAccess {
		const current = this.entries[access.key];
		if (current) Object.assign(current, access);
		else this.entries[access.key] = access;
		return this.entries[access.key];
	}

	get(key: string): MediaAccess | undefined {
		return this.entries[key];
	}

	clear(): void {
		for (const access of Object.values(this.entries)) access.url = '';
		this.entries = {};
	}
}

export const mediaAccess = new MediaAccessState();
