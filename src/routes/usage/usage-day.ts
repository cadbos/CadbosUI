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

import { resolve } from '$app/paths';
import type { PathnameWithSearchOrHash } from '$app/types';
import type { UsageDay } from '$lib/state/user-usage.svelte';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The viewer's local calendar day of a timestamp, as shown in the usage tables.
export function localDateKey(timestamp: number): string {
	const date = new Date(timestamp);
	return [
		String(date.getFullYear()).padStart(4, '0'),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0')
	].join('-');
}

// Bounds of that local day — built from calendar fields rather than adding
// 24 hours, so days shortened or lengthened by a DST switch stay whole.
export function localDay(dateKey: string): UsageDay | null {
	const match = ISO_DATE.exec(dateKey);
	if (!match) return null;
	const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
	const start = new Date(year, month, day);
	if (start.getFullYear() !== year || start.getMonth() !== month || start.getDate() !== day) {
		return null;
	}
	return { from: start.getTime(), to: new Date(year, month, day + 1).getTime() };
}

export function userUsageHref(npub: string, dateKey?: string): string {
	const search = new URLSearchParams({ npub, ...(dateKey === undefined ? {} : { date: dateKey }) });
	return resolve(`/usage/by-user?${search}` as PathnameWithSearchOrHash, {});
}
