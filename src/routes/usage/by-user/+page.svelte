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
	import { currency } from '$lib/state/currency.svelte';
	import { usage, type UsageDay } from '$lib/state/usage.svelte';
	import { userUsage } from '$lib/state/user-usage.svelte';
	import type { PageProps } from './$types';
	import PlatformTotals from '../PlatformTotals.svelte';
	import { localDay, userUsageHref } from '../usage-day';
	import UsageNumber from '../UsageNumber.svelte';
	import UsageTimestamp from '../UsageTimestamp.svelte';
	import UsageUser from '../UsageUser.svelte';

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
		untrack(() => {
			usage.loadTotals(selectedDay);
			userUsage.load(target, selectedDay);
		});
		return () => {
			userUsage.clear();
			usage.clear();
		};
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

	function formatSizeUnit(): string {
		const parts = new Intl.NumberFormat(getLocale(), {
			style: 'unit',
			unit: 'megabyte',
			unitDisplay: 'short'
		}).formatToParts(1);
		return parts.find((part) => part.type === 'unit')!.value;
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

<PlatformTotals dayLabel={day === null ? undefined : formatDay(day)} />

{#if auth.status !== 'authenticated'}
	<p class="status">{t('usage.signInRequired')}</p>
{:else if pubkey === null}
	<p class="status error" role="alert">{t('usage.byUser.invalidNpub')}</p>
{:else if dateKey !== null && day === null}
	<p class="status error" role="alert">{t('usage.byUser.invalidDate')}</p>
{:else if userUsage.status === 'loading'}
	<div class="table-wrap" aria-busy="true" aria-label={t('usage.byUser.loading')}>
		<table>
			<tbody>
				{#each [0, 1, 2, 3, 4, 5] as slot (slot)}
					<tr aria-hidden="true">
						<td><SkeletonBlock width="9rem" height="0.75rem" /></td>
						<td><SkeletonBlock width="6rem" height="0.75rem" /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if userUsage.status === 'not-found'}
	<p class="status error" role="alert">{t('usage.byUser.notFound')}</p>
{:else if userUsage.status === 'error'}
	<p class="status error" role="alert">{t('usage.byUser.failed')}</p>
{:else if userUsage.record !== null}
	{@const record = userUsage.record}
	<div class="table-wrap">
		<table class="key-value">
			<caption class="visually-hidden">{t('usage.byUser.summary')}</caption>
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
					<th scope="row">{t('usage.column.balance')}, {currency.symbol}</th>
					<td class="numeric-column"
						><UsageNumber kind="currency" value={record.balance} showUnit={false} /></td
					>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.totalDeposit')}, {currency.symbol}</th>
					<td class="numeric-column"
						><UsageNumber kind="currency" value={record.totalDeposit} showUnit={false} /></td
					>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.lastDepositAt')}</th>
					<td><UsageTimestamp timestamp={record.lastDepositAt} /></td>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.projectCount')}</th>
					<td class="numeric-column"><UsageNumber kind="count" value={record.projectCount} /></td>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.sessionCount')}</th>
					<td class="numeric-column"><UsageNumber kind="count" value={record.sessionCount} /></td>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.generationCount')}</th>
					<td class="numeric-column"><UsageNumber kind="count" value={record.generationCount} /></td
					>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.sourceCount')}</th>
					<td class="numeric-column"><UsageNumber kind="count" value={record.sourceCount} /></td>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.sourceBytes')}, {formatSizeUnit()}</th>
					<td class="numeric-column"
						><UsageNumber kind="size" value={record.sourceBytes} showUnit={false} /></td
					>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.referenceCount')}</th>
					<td class="numeric-column"><UsageNumber kind="count" value={record.referenceCount} /></td>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.referenceBytes')}, {formatSizeUnit()}</th>
					<td class="numeric-column"
						><UsageNumber kind="size" value={record.referenceBytes} showUnit={false} /></td
					>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.totalSpend')}, {currency.symbol}</th>
					<td class="numeric-column"
						><UsageNumber kind="currency" value={record.totalSpend} showUnit={false} /></td
					>
				</tr>
				<tr>
					<th scope="row">{t('usage.column.latestSpendAt')}</th>
					<td><UsageTimestamp timestamp={record.latestSpendAt} {npub} /></td>
				</tr>
			</tbody>
		</table>
	</div>

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
									<td class="prompt">{generation.prompt || t('usage.emptyValue')}</td>
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

	.key-value tbody th {
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.usage-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
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
		min-width: 16rem;
		max-width: 32rem;
		white-space: normal;
		line-height: 1.4;
	}

	.thumbnail {
		--image-width: 3rem;
		--image-height: 3rem;
		--image-radius: var(--radius-sm);
		--image-fit: cover;
		display: inline-flex;
	}
</style>
