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
	import type { GenerationKind } from '$lib/api/contract';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { getLocale, t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { userUsage, type UsageDay } from '$lib/state/user-usage.svelte';
	import type { PageProps } from './$types';
	import { localDay, userUsageHref } from '../usage-day';
	import UsageNumber from '../UsageNumber.svelte';
	import UsageTimestamp from '../UsageTimestamp.svelte';
	import UsageUser from '../UsageUser.svelte';
	import UsagePrompt from './UsagePrompt.svelte';

	let { data }: PageProps = $props();

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

	// The URL is the source of truth: changing either param reloads the page's data.
	const npub = $derived(page.url.searchParams.get('npub') ?? '');
	const dateKey = $derived(page.url.searchParams.get('date'));
	const pubkey = $derived(decodeNpub(npub));
	const day = $derived(dateKey === null ? null : localDay(dateKey));

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
		untrack(() => userUsage.load(target, selectedDay));
		return () => userUsage.clear();
	}

	$effect(loadUserUsage);

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

	function formatDay(selectedDay: UsageDay): string {
		return new Intl.DateTimeFormat(getLocale(), {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(new Date(selectedDay.from));
	}

	function formatTime(timestamp: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		}).format(new Date(timestamp));
	}
</script>

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
	<h1>{t('usage.byUser.title')}</h1>
	{#if day === null}
		<p>{t('usage.byUser.subtitle')}</p>
	{:else}
		<p>
			{ti('usage.byUser.daySubtitle', { date: formatDay(day) })}
			<a href={userUsageHref(npub)}>{t('usage.byUser.allTime')}</a>
		</p>
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
	<section class="totals" aria-labelledby="user-totals-title" aria-busy={record === null}>
		<h2 id="user-totals-title" class="totals-title">
			{day === null
				? ti('usage.byUser.totalsTitle', { user: npub })
				: ti('usage.byUser.dayTotalsTitle', { user: npub, date: formatDay(day) })}
		</h2>
		{#if record === null}
			<dl aria-hidden="true">
				{#each [0, 1, 2, 3, 4, 5, 6, 7] as slot (slot)}
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
			</dl>
		{/if}
	</section>

	{#if record !== null}
		<div class="usage-columns">
			<section class="usage-section" aria-labelledby="usage-summary-title">
				<h2 id="usage-summary-title">{t('usage.byUser.summary')}</h2>
				<div class="table-wrap">
					<table class="key-value" aria-labelledby="usage-summary-title">
						<tbody>
							<tr>
								<th scope="row">{t('usage.column.user')}</th>
								<td>
									<UsageUser
										pubkey={record.pubkey}
										profile={userUsage.profile}
										pubkeyViewer={data.pubkeyViewer}
									/>
								</td>
							</tr>
							<tr>
								<th scope="row">{t('usage.column.lastDepositAt')}</th>
								<td><UsageTimestamp timestamp={record.lastDepositAt} /></td>
							</tr>
							<tr>
								<th scope="row">{t('usage.column.latestSpendAt')}</th>
								<td><UsageTimestamp timestamp={record.latestSpendAt} {npub} /></td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>

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
										<th scope="row">{t(generationKindKeys[entry.kind])}</th>
										<td class="numeric-column"><UsageNumber kind="count" value={entry.count} /></td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		</div>

		{#if day !== null}
			<section class="usage-section" aria-labelledby="usage-generations-title">
				<h2 id="usage-generations-title">{t('usage.generations.title')}</h2>
				{#if userUsage.generationsStatus === 'loading'}
					<p class="status">{t('usage.generations.loading')}</p>
				{:else if userUsage.generationsStatus === 'error' && userUsage.generations.length === 0}
					<p class="status error" role="alert">{t('usage.generations.failed')}</p>
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
										<td>{formatTime(generation.createdAt)}</td>
										<td>{t(generationKindKeys[generation.kind])}</td>
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
						<p class="status error" role="alert">{t('usage.generations.failed')}</p>
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

	.totals-title {
		overflow-wrap: anywhere;
	}

	.usage-columns {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		align-items: start;
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

	.key-value tbody th {
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.key-value td {
		text-align: right;
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

	@media (max-width: 720px) {
		.usage-columns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
