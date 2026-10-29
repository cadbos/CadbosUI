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

import type { GenerationKind } from '$lib/api/contract';
import { getLocale, t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
import { currency } from '$lib/state/currency.svelte';
import { formatCredit } from '$lib/utils';
import { localDateKey } from './usage-day';

export type UsageValue =
	| { kind: 'count'; value: number | null }
	| { kind: 'currency' | 'size'; value: number | null; showUnit?: boolean }
	| { kind: 'countWithSize'; value: number; bytes: number | null };

const generationKindKeys: Record<GenerationKind, TranslationKey> = {
	render: 'generatedImages.kind.render',
	edit: 'generatedImages.kind.edit',
	'style-transfer': 'generatedImages.kind.styleTransfer',
	upscale: 'generatedImages.kind.upscale',
	'photo-processing': 'generatedImages.kind.photo-processing',
	'object-replacement': 'generatedImages.kind.objectReplacement',
	'texture-replacement': 'generatedImages.kind.textureReplacement',
	'light-settings': 'generatedImages.kind.lightSettings',
	repaint: 'generatedImages.kind.repaint'
};

const numericPartTypes = new Set(['integer', 'group', 'decimal', 'fraction', 'minusSign']);

function formatNumber(value: number, maximumFractionDigits: number): string {
	const parts = new Intl.NumberFormat('en-US', { maximumFractionDigits }).formatToParts(value);
	const groupSeparator = parts.some((part) => part.type === 'decimal') ? ',' : ' ';
	return parts.map((part) => (part.type === 'group' ? groupSeparator : part.value)).join('');
}

function formatSize(bytes: number | null, showUnit = true): string {
	if (bytes === null) return t('usage.emptyValue');

	const value = bytes / 1024 ** 2;
	const maximumFractionDigits = 1;
	const number = formatNumber(value, maximumFractionDigits);
	if (!showUnit) return number;

	const parts = new Intl.NumberFormat(getLocale(), {
		style: 'unit',
		unit: 'megabyte',
		unitDisplay: 'short',
		maximumFractionDigits
	}).formatToParts(value);
	const firstNumberPart = parts.findIndex((part) => numericPartTypes.has(part.type));
	const lastNumberPart = parts.findLastIndex((part) => numericPartTypes.has(part.type));
	return (
		parts
			.slice(0, firstNumberPart)
			.map((part) => part.value)
			.join('') +
		number +
		parts
			.slice(lastNumberPart + 1)
			.map((part) => part.value)
			.join('')
	);
}

export function formatUsageValue(usageValue: UsageValue): string {
	if (usageValue.kind === 'countWithSize') {
		return ti('usage.totals.countWithSize', {
			count: formatNumber(usageValue.value, 0),
			size: formatSize(usageValue.bytes)
		});
	}
	if (usageValue.value === null) return t('usage.emptyValue');
	if (usageValue.kind === 'currency') {
		const amount = formatCredit(currency.convert(usageValue.value));
		const formattedAmount = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		return usageValue.showUnit === false
			? formattedAmount
			: `${currency.symbol} ${formattedAmount}`;
	}
	if (usageValue.kind === 'size') return formatSize(usageValue.value, usageValue.showUnit);
	return formatNumber(usageValue.value, 0);
}

// The local time of day a usage timestamp shows, e.g. "18:35".
export function formatUsageTimeOfDay(timestamp: number): string {
	return new Intl.DateTimeFormat(getLocale(), {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(timestamp));
}

// Joins the ISO 8601 local date and the time of day: "2026-09-12 | 18:35".
export const TIMESTAMP_SEPARATOR = ' | ';

export function formatUsageTimestamp(timestamp: number): string {
	return `${localDateKey(timestamp)}${TIMESTAMP_SEPARATOR}${formatUsageTimeOfDay(timestamp)}`;
}

// A whole calendar day, from its local start.
export function formatUsageDay(dayStart: number): string {
	return new Intl.DateTimeFormat(getLocale(), {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(new Date(dayStart));
}

export function formatGenerationKind(kind: GenerationKind): string {
	return t(generationKindKeys[kind]);
}
