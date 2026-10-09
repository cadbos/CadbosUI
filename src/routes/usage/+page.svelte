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
	import { npubEncode } from 'nostr-tools/nip19';
	import type { PageProps } from './$types';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { usage } from '$lib/state/usage.svelte';
	import UsageNumber from './UsageNumber.svelte';

	let { data }: PageProps = $props();

	let loadMoreSentinel = $state<HTMLElement | null>(null);
	let failedPicturePubkeys = $state<string[]>([]);
	let timeZone = $derived('UTC');
	$effect(() => {
		timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	});
	let timeZoneAbbreviation = $derived(formatTimeZoneName('short'));
	let timeZoneFullName = $derived(formatTimeZoneName('long'));

	$effect(() => {
		// Wait for the shared auth store, not just the session cookie, so the
		// header's sign-in indicator and this page's data never disagree (the
		// header alone showing "Гость" must not coexist with a loaded table).
		if (auth.status !== 'authenticated') return;
		void usage.load();
		return () => usage.clear();
	});

	$effect(() => {
		const sentinel = loadMoreSentinel;
		if (!sentinel || !usage.hasMore) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void usage.loadMore();
			},
			{ root: null, rootMargin: '0px 0px 240px 0px' }
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	});

	function formatTimestamp(timestamp: number | null): string {
		if (timestamp === null) return t('usage.emptyValue');
		return new Intl.DateTimeFormat(getLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		}).format(new Date(timestamp));
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

	function markPictureFailed(pubkey: string): void {
		if (!failedPicturePubkeys.includes(pubkey))
			failedPicturePubkeys = [...failedPicturePubkeys, pubkey];
	}
</script>

{#snippet usageSkeletonRow(key: string)}
	<tr aria-hidden="true">
		{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as cell (`${key}-${cell}`)}
			<td><SkeletonBlock width={cell === 0 ? '8rem' : '3.5rem'} height="0.75rem" /></td>
		{/each}
	</tr>
{/snippet}

<svelte:head>
	<title>{t('usage.title')}</title>
</svelte:head>

<main class="usage-page" aria-labelledby="usage-title">
	<section class="usage-shell">
		<header class="usage-header">
			<h1 id="usage-title">{t('usage.title')}</h1>
			<p>{t('usage.subtitle')}</p>
		</header>

		{#if usage.totalsStatus !== 'idle' || usage.walletBalanceStatus !== 'idle' || usage.d1LimitsStatus !== 'idle'}
			<section class="totals" aria-labelledby="usage-totals-title">
				<h2 id="usage-totals-title">{t('usage.totals.title')}</h2>
				<dl>
					<div>
						<dt>{t('usage.totals.walletBalance')}</dt>
						{#if usage.walletBalanceStatus === 'loading'}
							<dd><SkeletonBlock width="5rem" height="1rem" /></dd>
							<p class="visually-hidden">{t('usage.walletBalanceLoading')}</p>
						{:else if usage.walletBalanceStatus === 'error'}
							<dd class="tile-status error" role="alert">{t('usage.walletBalanceFailed')}</dd>
						{:else if usage.walletBalanceStatus === 'ready' && usage.walletBalance !== null}
							<dd><UsageNumber kind="currency" value={usage.walletBalance} /></dd>
						{/if}
					</div>
					{#if usage.totalsStatus === 'ready' && usage.totals !== null}
						<div>
							<dt>{t('usage.totals.deposits')}</dt>
							<dd><UsageNumber kind="count" value={null} /></dd>
						</div>
						<div>
							<dt>{t('usage.totals.spend')}</dt>
							<dd><UsageNumber kind="currency" value={usage.totals.totalSpend} /></dd>
						</div>
						<div>
							<dt>{t('usage.totals.users')}</dt>
							<dd><UsageNumber kind="count" value={usage.totals.userCount} /></dd>
						</div>
						<div>
							<dt>{t('usage.totals.projects')}</dt>
							<dd><UsageNumber kind="count" value={usage.totals.projectCount} /></dd>
						</div>
						<div>
							<dt>{t('usage.totals.sessions')}</dt>
							<dd><UsageNumber kind="count" value={usage.totals.sessionCount} /></dd>
						</div>
						<div>
							<dt>{t('usage.totals.generations')}</dt>
							<dd><UsageNumber kind="count" value={usage.totals.generationCount} /></dd>
						</div>
						<div>
							<dt>{t('usage.totals.sources')}</dt>
							<dd>
								<UsageNumber
									kind="countWithSize"
									value={usage.totals.sourceCount}
									bytes={usage.totals.sourceBytes}
								/>
							</dd>
						</div>
						<div>
							<dt>{t('usage.totals.references')}</dt>
							<dd>
								<UsageNumber
									kind="countWithSize"
									value={usage.totals.referenceCount}
									bytes={usage.totals.referenceBytes}
								/>
							</dd>
						</div>
					{/if}
					{#if usage.d1LimitsStatus === 'ready' && usage.d1Limits !== null}
						<div>
							<dt>{ti('usage.totals.d1RowsRead', { date: usage.d1Limits.date })}</dt>
							<dd>
								<span class="d1-quotient">
									<span class="d1-used"
										><UsageNumber kind="count" value={usage.d1Limits.rowsRead} /></span
									>
									<span class="d1-divider">{t('usage.totals.d1DivisionSign')}</span>
									<span class="d1-limit"
										><UsageNumber kind="count" value={usage.d1Limits.readLimit} /></span
									>
								</span>
								{#if usage.d1Limits.rowsRead >= usage.d1Limits.readLimit}
									<span class="limit-reached" role="status">{t('usage.totals.d1LimitReached')}</span
									>
								{/if}
							</dd>
						</div>
						<div>
							<dt>{ti('usage.totals.d1RowsWritten', { date: usage.d1Limits.date })}</dt>
							<dd>
								<span class="d1-quotient">
									<span class="d1-used"
										><UsageNumber kind="count" value={usage.d1Limits.rowsWritten} /></span
									>
									<span class="d1-divider">{t('usage.totals.d1DivisionSign')}</span>
									<span class="d1-limit"
										><UsageNumber kind="count" value={usage.d1Limits.writeLimit} /></span
									>
								</span>
								{#if usage.d1Limits.rowsWritten >= usage.d1Limits.writeLimit}
									<span class="limit-reached" role="status">{t('usage.totals.d1LimitReached')}</span
									>
								{/if}
							</dd>
						</div>
					{/if}
					{#if usage.totalsStatus === 'loading'}
						{#each [0, 1, 2, 3, 4, 5, 6, 7] as slot (slot)}
							<div aria-hidden="true">
								<dt><SkeletonBlock width="70%" height="0.7rem" /></dt>
								<dd><SkeletonBlock width="4.5rem" height="1rem" /></dd>
							</div>
						{/each}
					{/if}
					{#if usage.d1LimitsStatus === 'loading'}
						{#each [0, 1] as slot (`d1-${slot}`)}
							<div aria-hidden="true">
								<dt><SkeletonBlock width="80%" height="0.7rem" /></dt>
								<dd><SkeletonBlock width="5rem" height="1rem" /></dd>
							</div>
						{/each}
					{/if}
				</dl>
				{#if usage.totalsStatus === 'loading'}
					<p class="visually-hidden">{t('usage.totals.loading')}</p>
				{:else if usage.totalsStatus === 'error'}
					<p class="status error" role="alert">{t('usage.totals.failed')}</p>
				{/if}
				{#if usage.d1LimitsStatus === 'loading'}
					<p class="visually-hidden">{t('usage.totals.d1Loading')}</p>
				{:else if usage.d1LimitsStatus === 'error'}
					<p class="status error" role="alert">{t('usage.totals.d1Failed')}</p>
				{/if}
			</section>
		{/if}

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
							<th scope="col" class="numeric-column"
								>{t('usage.column.balance')}, {currency.symbol}</th
							>
							<th scope="col" class="numeric-column"
								>{t('usage.column.totalDeposit')}, {currency.symbol}</th
							>
							<th scope="col">{t('usage.column.lastDepositAt')}</th>
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
						</tr>
					</thead>
					<tbody>
						{#each usage.users as user (user.pubkey)}
							{@const npub = npubEncode(user.pubkey)}
							{@const profile = usage.profiles[user.pubkey]}
							{@const picture = failedPicturePubkeys.includes(user.pubkey)
								? undefined
								: profile?.picture}
							{@const avatarLabel = profile?.name ?? npub}
							<tr>
								<th scope="row" class="pubkey" title={npub}>
									<span class="user-identity">
										{#if picture}
											<LazyImage
												src={picture}
												alt=""
												decorative
												fetchPriority="low"
												onError={() => markPictureFailed(user.pubkey)}
											/>
										{:else}
											<span class="avatar" aria-hidden="true"
												>{[...avatarLabel][0]?.toUpperCase()}</span
											>
										{/if}
										<a
											href={data.pubkeyViewer.replaceAll('{}', npub)}
											target="_blank"
											rel="noopener noreferrer">{npub}</a
										>
									</span>
								</th>
								<td class="numeric-column"
									><UsageNumber kind="currency" value={user.balance} showUnit={false} /></td
								>
								<td class="numeric-column"
									><UsageNumber kind="currency" value={user.totalDeposit} showUnit={false} /></td
								>
								<td>{formatTimestamp(user.lastDepositAt)}</td>
								<td class="numeric-column"
									><UsageNumber kind="count" value={user.projectCount} /></td
								>
								<td class="numeric-column"
									><UsageNumber kind="count" value={user.sessionCount} /></td
								>
								<td class="numeric-column"
									><UsageNumber kind="count" value={user.generationCount} /></td
								>
								<td class="numeric-column"><UsageNumber kind="count" value={user.sourceCount} /></td
								>
								<td class="numeric-column"
									><UsageNumber kind="size" value={user.sourceBytes} showUnit={false} /></td
								>
								<td class="numeric-column"
									><UsageNumber kind="count" value={user.referenceCount} /></td
								>
								<td class="numeric-column"
									><UsageNumber kind="size" value={user.referenceBytes} showUnit={false} /></td
								>
								<td class="numeric-column"
									><UsageNumber kind="currency" value={user.totalSpend} showUnit={false} /></td
								>
								<td>{formatTimestamp(user.latestSpendAt)}</td>
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
				<div bind:this={loadMoreSentinel} class="load-more-sentinel">
					{#if usage.loadingMore}
						<p class="visually-hidden" aria-live="polite">{t('usage.loadingMore')}</p>
					{/if}
				</div>
			{/if}
			{#if usage.status === 'error'}
				<p class="status error" role="alert">{t('usage.failed')}</p>
			{/if}
		{/if}
	</section>
</main>

<style>
	.usage-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.usage-shell {
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: clamp(1rem, 2vw, 1.5rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}

	.usage-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	h1,
	.usage-header p,
	.status {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.usage-header p,
	.status {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.error {
		color: var(--color-danger);
	}

	.totals {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.totals h2 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 700;
	}

	.totals dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.totals dl > div {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
	}

	.totals dt {
		min-height: 2lh;
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.totals dd {
		margin: auto 0 0;
		color: var(--color-text);
		font-size: 1.125rem;
		font-weight: 700;
	}

	.totals dd.tile-status {
		text-align: left;
		font-size: 0.9375rem;
		font-weight: 500;
	}

	.totals .d1-quotient {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 0.375rem;
		font-variant-numeric: tabular-nums;
	}

	.totals .d1-used,
	.totals .d1-limit {
		grid-column: 2;
		text-align: right;
	}

	.totals .d1-used {
		grid-row: 1;
	}

	.totals .d1-limit {
		grid-row: 2;
	}

	.totals .d1-divider {
		grid-column: 1;
		grid-row: 1 / 3;
		align-self: center;
	}

	.totals .limit-reached {
		display: block;
		color: var(--color-danger);
		font-size: 0.8125rem;
	}

	.table-wrap {
		width: 100%;
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}

	table {
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	th,
	td {
		padding: 0.75rem;
		border-bottom: 1px solid var(--color-border);
		text-align: left;
		vertical-align: top;
		white-space: nowrap;
	}

	.numeric-column {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-background);
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	tbody tr:last-child th,
	tbody tr:last-child td {
		border-bottom: 0;
	}

	tbody tr:hover {
		background: var(--color-surface-hover);
	}

	tbody th,
	td {
		color: var(--color-text);
		font-weight: 500;
	}

	.pubkey {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		vertical-align: middle;
	}

	.user-identity {
		--image-width: 2rem;
		--image-height: 2rem;
		--image-radius: 50%;
		--image-fit: cover;
		--image-flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		white-space: nowrap;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		flex: 0 0 auto;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		font-family: inherit;
		font-weight: 700;
	}

	.pubkey a {
		color: var(--color-accent-text);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.pubkey a:hover {
		color: var(--color-accent-hover);
	}

	.load-more-sentinel {
		min-height: 3rem;
		display: flex;
		align-items: center;
	}

	@media (max-width: 720px) {
		.usage-page {
			padding: 1rem;
		}

		.usage-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}
	}
</style>
