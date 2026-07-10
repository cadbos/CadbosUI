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
	import { getLocale, t } from '$lib/i18n/index.svelte';
	import { usage } from '$lib/state/usage.svelte';
	import { formatCredit } from '$lib/utils';

	let loadMoreSentinel = $state<HTMLElement | null>(null);

	$effect(() => {
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
</script>

<svelte:head>
	<title>{t('usage.title')}</title>
</svelte:head>

<main class="usage-page" aria-labelledby="usage-title">
	<section class="usage-shell">
		<header class="usage-header">
			<h1 id="usage-title">{t('usage.title')}</h1>
			<p>{t('usage.subtitle')}</p>
		</header>

		{#if usage.status === 'loading'}
			<p class="status">{t('usage.loading')}</p>
		{:else if usage.status === 'error' && usage.users.length === 0}
			<p class="status error" role="alert">{t('usage.failed')}</p>
		{:else if usage.users.length === 0}
			<p class="status">{t('usage.empty')}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">{t('usage.column.pubkey')}</th>
							<th scope="col">{t('usage.column.balance')}</th>
							<th scope="col">{t('usage.column.totalDeposit')}</th>
							<th scope="col">{t('usage.column.lastDepositAt')}</th>
							<th scope="col">{t('usage.column.generationCount')}</th>
							<th scope="col">{t('usage.column.totalSpend')}</th>
							<th scope="col">{t('usage.column.latestSpendAt')}</th>
						</tr>
					</thead>
					<tbody>
						{#each usage.users as user (user.pubkey)}
							<tr>
								<th scope="row" class="pubkey" title={user.pubkey}>{user.pubkey}</th>
								<td>{formatCredit(user.balance)}</td>
								<td>{formatCredit(user.totalDeposit)}</td>
								<td>{formatTimestamp(user.lastDepositAt)}</td>
								<td>{user.generationCount}</td>
								<td>{formatCredit(user.totalSpend)}</td>
								<td>{formatTimestamp(user.latestSpendAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if usage.hasMore}
				<div bind:this={loadMoreSentinel} class="load-more-sentinel">
					{#if usage.loadingMore}
						<p class="status" aria-live="polite">{t('usage.loadingMore')}</p>
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
