<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate written
agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<script lang="ts">
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { formatCredit } from '$lib/utils';

	type Props =
		| { kind: 'count' | 'currency' | 'size'; value: number | null }
		| { kind: 'countWithSize'; value: number; bytes: number | null };

	let props: Props = $props();

	const byteUnits = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
	const numericPartTypes = new Set(['integer', 'group', 'decimal', 'fraction', 'minusSign']);

	function formatNumber(value: number, maximumFractionDigits: number): string {
		const parts = new Intl.NumberFormat('en-US', { maximumFractionDigits }).formatToParts(value);
		return parts.map((part) => (part.type === 'group' ? ' ' : part.value)).join('');
	}

	function formatSize(bytes: number | null): string {
		if (bytes === null) return t('usage.emptyValue');

		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < byteUnits.length - 1) {
			value /= 1024;
			unit += 1;
		}

		const maximumFractionDigits = unit === 0 ? 0 : 1;
		const parts = new Intl.NumberFormat(getLocale(), {
			style: 'unit',
			unit: byteUnits[unit],
			unitDisplay: 'short',
			maximumFractionDigits
		}).formatToParts(value);
		const firstNumberPart = parts.findIndex((part) => numericPartTypes.has(part.type));
		const lastNumberPart = parts.findLastIndex((part) => numericPartTypes.has(part.type));
		const number = formatNumber(value, maximumFractionDigits);
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

	function formatValue(): string {
		if (props.kind === 'countWithSize') {
			return ti('usage.totals.countWithSize', {
				count: formatNumber(props.value, 0),
				size: formatSize(props.bytes)
			});
		}
		if (props.value === null) return t('usage.emptyValue');
		if (props.kind === 'currency') {
			const amount = formatCredit(currency.convert(props.value));
			return `${currency.symbol} ${amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
		}
		if (props.kind === 'size') return formatSize(props.value);
		return formatNumber(props.value, 0);
	}
</script>

<span class="number">{formatValue()}</span>

<style>
	.number {
		display: block;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
