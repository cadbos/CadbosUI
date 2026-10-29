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
	import { untrack } from 'svelte';
	import { decode } from 'nostr-tools/nip19';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { FileDown } from '@lucide/svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { formatShortNpub } from '$lib/nostr/short-npub';
	import { auth } from '$lib/state/auth.svelte';
	import { logBoundaryError } from '$lib/utils';
	import { userUsage } from '$lib/state/user-usage.svelte';
	import { localDay, userUsageHref } from '../usage-day';
	import { formatGenerationKind, formatUsageDay, formatUsageTimestamp } from '../usage-format';
	import UsageNumber from '../UsageNumber.svelte';
	import UsageTimestamp from '../UsageTimestamp.svelte';
	import UsageKeyActions from './UsageKeyActions.svelte';
	import UsagePrompt from './UsagePrompt.svelte';
	import { buildUserUsageMarkdown } from './user-usage-markdown';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The URL is the source of truth: changing either param reloads the page's data.
	const npub = $derived(page.url.searchParams.get('npub') ?? '');
	const dateKey = $derived(page.url.searchParams.get('date'));
	const pubkey = $derived(decodeNpub(npub));
	const day = $derived(dateKey === null ? null : localDay(dateKey));

	let exporting = $state(false);
	let exportFailed = $state(false);
	// Bumped on every reload, so an export the reload cut short reports nothing
	// on the view that replaced it.
	let loadVersion = 0;

	function decodeNpub(value: string): string | null {
		if (!value.startsWith('npub1')) return null;
		try {
			const decoded = decode(value);
			return decoded.type === 'npub' ? decoded.data : null;
		} catch (error) {
			console.error('Usage npub is invalid:', error instanceof Error ? error.message : error);
			return null;
		}
	}

	function loadUserUsage(): (() => void) | undefined {
		if (auth.status !== 'authenticated') return;
		const target = pubkey;
		const selectedDay = day;
		if (target === null || (dateKey !== null && selectedDay === null)) return;
		untrack(() => {
			loadVersion += 1;
			exportFailed = false;
			userUsage.load(target, selectedDay);
		});
		return () => userUsage.clear();
	}

	$effect(loadUserUsage);

	async function exportMarkdown(): Promise<void> {
		const record = userUsage.record;
		if (record === null) return;
		const version = loadVersion;
		exporting = true;
		exportFailed = false;
		try {
			const markdown = buildUserUsageMarkdown({
				npub,
				dayStart: day?.from ?? null,
				record,
				generationKinds: userUsage.generationKinds,
				generations: day === null ? null : await userUsage.loadAllGenerations(),
				origin: page.url.origin
			});
			const url = URL.createObjectURL(
				new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
			);
			const link = document.createElement('a');
			link.href = url;
			link.download = `cadbos-usage-${npub}${dateKey === null ? '' : `-${dateKey}`}.md`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		} catch (error) {
			logBoundaryError('usageByUser.exportMarkdown', error);
			if (version === loadVersion) exportFailed = true;
		} finally {
			exporting = false;
		}
	}

	function observeLoadMore(sentinel: HTMLElement): () => void {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void userUsage.loadMoreGenerations();
			},
			{ root: null, rootMargin: '0px 0px 240px 0px' }
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	}
</script>

{#snippet generationsFailed()}
	<div class="generations-failed">
		<p class="status error" role="alert">{t('usage.generations.failed')}</p>
		<button
			type="button"
			class="retry-button"
			disabled={userUsage.loadingMoreGenerations}
			onclick={() => void userUsage.loadMoreGenerations()}
		>
			{t('usage.generations.retry')}
		</button>
	</div>
{/snippet}

{#snippet thumbnail(url: string, alt: string)}
	<a class="thumbnail" href={url} target="_blank" rel="noopener noreferrer">
		<LazyImage src={url} {alt} fetchPriority="low" />
	</a>
{/snippet}

<svelte:head>
	<title>{t('usage.byUser.title')}</title>
</svelte:head>

<header class="usage-header">
	<a class="back-link" href={resolve('/usage', {})}>{t('usage.byUser.back')}</a>
	<div class="heading-row">
		<div class="heading-key">
			<h1>
				{pubkey === null
					? t('usage.byUser.title')
					: ti('usage.byUser.heading', { user: formatShortNpub(npub) })}
			</h1>
			{#if pubkey !== null}
				<UsageKeyActions {npub} pubkeyViewer={data.pubkeyViewer} />
			{/if}
		</div>
		{#if auth.status === 'authenticated' && pubkey !== null && (dateKey === null || day !== null)}
			<button
				type="button"
				class="export-button"
				disabled={userUsage.status !== 'ready' || exporting}
				onclick={exportMarkdown}
			>
				<FileDown size={16} strokeWidth={1.8} aria-hidden="true" />
				{exporting ? t('usage.export.exporting') : t('usage.export.button')}
			</button>
		{/if}
	</div>
	{#if day === null}
		<p>{t('usage.byUser.subtitle')}</p>
	{:else}
		<p>
			{ti('usage.byUser.daySubtitle', { date: formatUsageDay(day.from) })}
			<a href={userUsageHref(npub)}>{t('usage.byUser.allTime')}</a>
		</p>
	{/if}
	{#if exportFailed}
		<p class="error" role="alert">{t('usage.export.failed')}</p>
	{/if}
</header>

{#if auth.status !== 'authenticated'}
	<p class="status">{t('usage.signInRequired')}</p>
{:else if pubkey === null}
	<p class="status error" role="alert">{t('usage.byUser.invalidNpub')}</p>
{:else if dateKey !== null && day === null}
	<p class="status error" role="alert">{t('usage.byUser.invalidDate')}</p>
{:else if userUsage.status === 'not-found'}
	<p class="status error" role="alert">{t('usage.byUser.notFound')}</p>
{:else if userUsage.status === 'error'}
	<p class="status error" role="alert">{t('usage.byUser.failed')}</p>
{:else}
	{@const record = userUsage.record}
	<section class="totals" aria-label={t('usage.byUser.summary')} aria-busy={record === null}>
		{#if record === null}
			<dl aria-hidden="true">
				{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as slot (slot)}
					<div>
						<dt><SkeletonBlock width="70%" height="0.7rem" /></dt>
						<dd><SkeletonBlock width="4.5rem" height="1rem" /></dd>
					</div>
				{/each}
			</dl>
			<p class="visually-hidden">{t('usage.byUser.loading')}</p>
		{:else}
			<dl>
				<div>
					<dt>{t('usage.column.balance')}</dt>
					<dd><UsageNumber kind="currency" value={record.balance} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.deposits')}</dt>
					<dd><UsageNumber kind="currency" value={record.totalDeposit} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.spend')}</dt>
					<dd><UsageNumber kind="currency" value={record.totalSpend} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.projects')}</dt>
					<dd><UsageNumber kind="count" value={record.projectCount} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.sessions')}</dt>
					<dd><UsageNumber kind="count" value={record.sessionCount} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.generations')}</dt>
					<dd><UsageNumber kind="count" value={record.generationCount} /></dd>
				</div>
				<div>
					<dt>{t('usage.totals.sources')}</dt>
					<dd>
						<UsageNumber
							kind="countWithSize"
							value={record.sourceCount}
							bytes={record.sourceBytes}
						/>
					</dd>
				</div>
				<div>
					<dt>{t('usage.totals.references')}</dt>
					<dd>
						<UsageNumber
							kind="countWithSize"
							value={record.referenceCount}
							bytes={record.referenceBytes}
						/>
					</dd>
				</div>
				<div>
					<dt>{t('usage.column.lastDepositAt')}</dt>
					<dd class="tile-time"><UsageTimestamp timestamp={record.lastDepositAt} /></dd>
				</div>
				<div>
					<dt>{t('usage.column.latestSpendAt')}</dt>
					<dd class="tile-time"><UsageTimestamp timestamp={record.latestSpendAt} {npub} /></dd>
				</div>
			</dl>
		{/if}
	</section>

	{#if record !== null}
		<section class="usage-section" aria-labelledby="usage-kinds-title">
			<h2 id="usage-kinds-title">{t('usage.kinds.title')}</h2>
			{#if userUsage.generationKinds.length === 0}
				<p class="status">{t('usage.kinds.empty')}</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th scope="col">{t('usage.kinds.column.kind')}</th>
								<th scope="col" class="numeric-column">{t('usage.kinds.column.count')}</th>
							</tr>
						</thead>
						<tbody>
							{#each userUsage.generationKinds as entry (entry.kind)}
								<tr>
									<th scope="row">{formatGenerationKind(entry.kind)}</th>
									<td class="numeric-column"><UsageNumber kind="count" value={entry.count} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		{#if day !== null}
			<section class="usage-section" aria-labelledby="usage-generations-title">
				<h2 id="usage-generations-title">{t('usage.generations.title')}</h2>
				{#if userUsage.generationsStatus === 'loading'}
					<p class="status">{t('usage.generations.loading')}</p>
				{:else if userUsage.generationsStatus === 'error' && userUsage.generations.length === 0}
					{@render generationsFailed()}
				{:else if userUsage.generations.length === 0}
					<p class="status">{t('usage.generations.empty')}</p>
				{:else}
					<div class="table-wrap">
						<table class="generations">
							<thead>
								<tr>
									<th scope="col">{t('usage.generations.column.id')}</th>
									<th scope="col">{t('usage.generations.column.time')}</th>
									<th scope="col">{t('usage.generations.column.kind')}</th>
									<th scope="col">{t('usage.generations.column.prompt')}</th>
									<th scope="col">{t('usage.generations.column.source')}</th>
									<th scope="col">{t('usage.generations.column.result')}</th>
									<th scope="col">{t('usage.generations.column.reference')}</th>
								</tr>
							</thead>
							<tbody>
								{#each userUsage.generations as generation (generation.id)}
									<tr>
										<th scope="row" class="generation-id">{generation.id}</th>
										<td>{formatUsageTimestamp(generation.createdAt)}</td>
										<td>{formatGenerationKind(generation.kind)}</td>
										<td class="prompt">
											{#if generation.prompt === ''}
												{t('usage.emptyValue')}
											{:else}
												<UsagePrompt id={generation.id} prompt={generation.prompt} />
											{/if}
										</td>
										<td>
											{@render thumbnail(
												generation.source.url,
												ti('usage.generations.sourceAlt', { id: generation.id })
											)}
										</td>
										<td>
											{@render thumbnail(
												generation.result.url,
												ti('usage.generations.resultAlt', { id: generation.id })
											)}
										</td>
										<td>
											{#if generation.reference === null}
												{t('usage.emptyValue')}
											{:else}
												{@render thumbnail(
													generation.reference.url,
													ti('usage.generations.referenceAlt', { id: generation.id })
												)}
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if userUsage.hasMoreGenerations}
						<div {@attach observeLoadMore} class="load-more-sentinel">
							{#if userUsage.loadingMoreGenerations}
								<p class="visually-hidden" aria-live="polite">{t('usage.loadingMore')}</p>
							{/if}
						</div>
					{/if}
					{#if userUsage.generationsStatus === 'error'}
						{@render generationsFailed()}
					{/if}
				{/if}
			</section>
		{/if}
	{/if}
{/if}

<style>
	.back-link,
	.usage-header p a {
		color: var(--color-accent-text);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.back-link {
		align-self: flex-start;
		font-size: 0.875rem;
	}

	.back-link:hover,
	.usage-header p a:hover {
		color: var(--color-accent-hover);
	}

	.heading-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.heading-key {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	h1 {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.generations-failed {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.export-button,
	.retry-button {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}

	.export-button:hover:not(:disabled),
	.retry-button:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.export-button:disabled,
	.retry-button:disabled {
		cursor: default;
		opacity: 0.6;
	}

	@media (max-width: 720px) {
		.heading-row {
			flex-direction: column;
		}
	}

	.totals .tile-time {
		font-size: 0.9375rem;
		text-align: right;
	}

	.usage-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.usage-section h2 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 700;
	}

	.generation-id {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.generations .prompt {
		width: 100%;
		max-width: 0;
		min-width: 12rem;
	}

	.thumbnail {
		--image-width: 3rem;
		--image-height: 3rem;
		--image-radius: var(--radius-sm);
		--image-fit: cover;
		display: flex;
		width: fit-content;
	}
</style>
