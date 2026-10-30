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
	import { onMount, untrack } from 'svelte';
	import { npubEncode } from 'nostr-tools/nip19';
	import type { PageProps } from './$types';
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { getLocale, t } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { usage } from '$lib/state/usage.svelte';
	import PlatformTotals from './PlatformTotals.svelte';
	import UsageNumber from './UsageNumber.svelte';
	import UsageTimestamp from './UsageTimestamp.svelte';
	import UsageUser from './UsageUser.svelte';

	let { data }: PageProps = $props();

	let timeZone = $state('UTC');
	onMount(() => {
		timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	});
	let timeZoneAbbreviation = $derived(formatTimeZoneName('short'));
	let timeZoneFullName = $derived(formatTimeZoneName('long'));

	function loadUsage(): (() => void) | undefined {
		// Wait for the shared auth store, not just the session cookie, so the
		// header's sign-in indicator and this page's data never disagree (the
		// header alone showing "Гость" must not coexist with a loaded table).
		if (auth.status !== 'authenticated') return;
		untrack(() => void usage.load());
		return () => usage.clear();
	}

	$effect(loadUsage);

	function observeLoadMore(sentinel: HTMLElement): () => void {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void usage.loadMore();
			},
			{ root: null, rootMargin: '0px 0px 240px 0px' }
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	}

	function formatTimeZoneName(timeZoneName: Intl.DateTimeFormatOptions['timeZoneName']): string {
		const formatter = new Intl.DateTimeFormat(getLocale(), { timeZone, timeZoneName });
		return (
			formatter.formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ??
			timeZone
		);
	}

	function formatSizeUnit(): string {
		const parts = new Intl.NumberFormat(getLocale(), {
			style: 'unit',
			unit: 'megabyte',
			unitDisplay: 'short'
		}).formatToParts(1);
		return parts.find((part) => part.type === 'unit')!.value;
	}
</script>

{#snippet usageSkeletonRow(key: string)}
	<tr aria-hidden="true">
		{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as cell (`${key}-${cell}`)}
			<td><SkeletonBlock width={cell === 0 ? '8rem' : '3.5rem'} height="0.75rem" /></td>
		{/each}
	</tr>
{/snippet}

<svelte:head>
	<title>{t('usage.title')}</title>
</svelte:head>

<header class="usage-header">
	<h1>{t('usage.title')}</h1>
	<p>{t('usage.subtitle')}</p>
</header>

<PlatformTotals />

{#if auth.status !== 'authenticated'}
	<p class="status">{t('usage.signInRequired')}</p>
{:else if usage.status === 'loading'}
	<div class="table-wrap" aria-busy="true" aria-label={t('usage.loading')}>
		<table>
			<tbody>
				{#each [0, 1, 2, 3, 4, 5] as slot (slot)}
					{@render usageSkeletonRow(String(slot))}
				{/each}
			</tbody>
		</table>
	</div>
{:else if usage.status === 'error' && usage.users.length === 0}
	<p class="status error" role="alert">{t('usage.failed')}</p>
{:else if usage.users.length === 0}
	<p class="status">{t('usage.empty')}</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">{t('usage.column.user')}</th>
					<th scope="col" class="numeric-column">{t('usage.column.balance')}, {currency.symbol}</th>
					<th scope="col" class="numeric-column"
						>{t('usage.column.totalDeposit')}, {currency.symbol}</th
					>
					<th scope="col" title={timeZoneFullName}
						>{t('usage.column.lastDepositAt')}, {timeZoneAbbreviation}</th
					>
					<th scope="col" class="numeric-column">{t('usage.column.projectCount')}</th>
					<th scope="col" class="numeric-column">{t('usage.column.sessionCount')}</th>
					<th scope="col" class="numeric-column">{t('usage.column.generationCount')}</th>
					<th scope="col" class="numeric-column">{t('usage.column.sourceCount')}</th>
					<th scope="col" class="numeric-column"
						>{t('usage.column.sourceBytes')}, {formatSizeUnit()}</th
					>
					<th scope="col" class="numeric-column">{t('usage.column.referenceCount')}</th>
					<th scope="col" class="numeric-column"
						>{t('usage.column.referenceBytes')}, {formatSizeUnit()}</th
					>
					<th scope="col" class="numeric-column"
						>{t('usage.column.totalSpend')}, {currency.symbol}</th
					>
					<th scope="col" title={timeZoneFullName}
						>{t('usage.column.latestSpendAt')}, {timeZoneAbbreviation}</th
					>
					<th scope="col" title={timeZoneFullName}
						>{t('usage.column.firstSignInAt')}, {timeZoneAbbreviation}</th
					>
					<th scope="col" title={timeZoneFullName}
						>{t('usage.column.lastSignInAt')}, {timeZoneAbbreviation}</th
					>
				</tr>
			</thead>
			<tbody>
				{#each usage.users as user (user.pubkey)}
					<tr>
						<th scope="row">
							<UsageUser
								pubkey={user.pubkey}
								profile={usage.profiles[user.pubkey]}
								pubkeyViewer={data.pubkeyViewer}
							/>
						</th>
						<td class="numeric-column"
							><UsageNumber kind="currency" value={user.balance} showUnit={false} /></td
						>
						<td class="numeric-column"
							><UsageNumber kind="currency" value={user.totalDeposit} showUnit={false} /></td
						>
						<td>
							<UsageTimestamp timestamp={user.lastDepositAt} npub={npubEncode(user.pubkey)} />
						</td>
						<td class="numeric-column"><UsageNumber kind="count" value={user.projectCount} /></td>
						<td class="numeric-column"><UsageNumber kind="count" value={user.sessionCount} /></td>
						<td class="numeric-column"><UsageNumber kind="count" value={user.generationCount} /></td
						>
						<td class="numeric-column"><UsageNumber kind="count" value={user.sourceCount} /></td>
						<td class="numeric-column"
							><UsageNumber kind="size" value={user.sourceBytes} showUnit={false} /></td
						>
						<td class="numeric-column"><UsageNumber kind="count" value={user.referenceCount} /></td>
						<td class="numeric-column"
							><UsageNumber kind="size" value={user.referenceBytes} showUnit={false} /></td
						>
						<td class="numeric-column"
							><UsageNumber kind="currency" value={user.totalSpend} showUnit={false} /></td
						>
						<td>
							<UsageTimestamp timestamp={user.latestSpendAt} npub={npubEncode(user.pubkey)} />
						</td>
						<td>
							<UsageTimestamp timestamp={user.firstSignInAt} npub={npubEncode(user.pubkey)} />
						</td>
						<td>
							<UsageTimestamp timestamp={user.lastSignInAt} npub={npubEncode(user.pubkey)} />
						</td>
					</tr>
				{/each}
				{#if usage.loadingMore}
					{#each [0, 1, 2] as slot (`more-${slot}`)}
						{@render usageSkeletonRow(`more-${slot}`)}
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	{#if usage.hasMore}
		<div {@attach observeLoadMore} class="load-more-sentinel">
			{#if usage.loadingMore}
				<p class="visually-hidden" aria-live="polite">{t('usage.loadingMore')}</p>
			{/if}
		</div>
	{/if}
	{#if usage.status === 'error'}
		<p class="status error" role="alert">{t('usage.failed')}</p>
	{/if}
{/if}
