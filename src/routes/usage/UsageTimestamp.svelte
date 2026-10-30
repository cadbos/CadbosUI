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
	import { t } from '$lib/i18n/index.svelte';
	import { localDateKey, userUsageHref } from './usage-day';
	import { formatUsageTimeOfDay, TIMESTAMP_SEPARATOR } from './usage-format';

	interface Props {
		timestamp: number | null;
		// Links the date to this user's usage on that day.
		npub?: string;
		// On a page already about one day, the date would repeat it.
		timeOnly?: boolean;
	}

	let { timestamp, npub, timeOnly = false }: Props = $props();

	const formatted = $derived(
		timestamp === null
			? null
			: {
					date: localDateKey(timestamp),
					time: formatUsageTimeOfDay(timestamp)
				}
	);
</script>

{#if formatted === null}
	{t('usage.emptyValue')}
{:else if timeOnly}
	<span class="part">{formatted.time}</span>
{:else}
	<span class="part"
		>{#if npub !== undefined}<a href={userUsageHref(npub, formatted.date)}>{formatted.date}</a
			>{:else}{formatted.date}{/if}</span
	>{TIMESTAMP_SEPARATOR}<span class="part">{formatted.time}</span>
{/if}

<style>
	/* A narrow cell wraps between the date and the time, never inside either. */
	.part {
		white-space: nowrap;
	}

	a {
		color: var(--color-accent-text);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	a:hover {
		color: var(--color-accent-hover);
	}
</style>
