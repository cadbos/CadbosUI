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
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import {
		resourceFilters,
		type ResourceFilter,
		type ResourceImageRecord
	} from '$lib/api/contract';
	import BlurFillImage from '$lib/components/BlurFillImage.svelte';
	import ImageSkeleton from '$lib/components/ImageSkeleton.svelte';
	import { getLocale, t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { resourceRoleLabels } from '$lib/resource-roles';
	import { resources } from '$lib/state/resources.svelte';
	import { createTabController, logBoundaryError } from '$lib/utils';

	const filterLabels: Record<ResourceFilter, TranslationKey> = {
		all: 'resources.filter.all',
		sources: 'resources.filter.sources',
		references: 'resources.filter.references'
	};

	const emptyLabels: Record<ResourceFilter, TranslationKey> = {
		all: 'resources.empty',
		sources: 'resources.emptySources',
		references: 'resources.emptyReferences'
	};

	// The URL is the source of truth for the active filter, so a reload, a
	// duplicated tab or a shared link opens on the same one; anything
	// unrecognized falls back to showing everything.
	const filter = $derived.by((): ResourceFilter => {
		const value = page.url.searchParams.get('filter');
		return resourceFilters.find((candidate) => candidate === value) ?? 'all';
	});

	let filterTabs = $state<HTMLElement[]>([]);
	let loadMoreSentinel = $state<HTMLElement | null>(null);
	let settledImageKeys = $state<string[]>([]);

	const filterTabController = createTabController({
		itemCount: () => resourceFilters.length,
		getActiveIndex: () => resourceFilters.indexOf(filter),
		setActiveIndex: (index) => {
			const next = resourceFilters[index];
			const url = next === 'all' ? '/resources' : `/resources?filter=${next}`;
			return goto(resolve(url as PathnameWithSearchOrHash, {}), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}).catch((error: unknown) => logBoundaryError('resourcesPage.filterNavigation', error));
		},
		focusTab: (index) => filterTabs[index]?.focus()
	});

	$effect(() => {
		void resources.load(filter);
		return () => resources.clear();
	});

	$effect(() => {
		const sentinel = loadMoreSentinel;
		if (!sentinel || !resources.hasMore) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void resources.loadMore();
			},
			{ root: null, rootMargin: '0px 0px 240px 0px' }
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	});

	function settleImage(key: string): void {
		if (settledImageKeys.includes(key)) return;
		settledImageKeys = [...settledImageKeys, key];
	}

	function formatCreatedAt(createdAt: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(createdAt));
	}

	function formatCreatedAtTime(createdAt: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		}).format(new Date(createdAt));
	}
</script>

{#snippet cardSkeleton()}
	<div class="card-body card-skeleton" aria-hidden="true">
		<span class="image-frame">
			<ImageSkeleton />
		</span>
		<span class="card-footer">
			<span class="sk-pill"><ImageSkeleton /></span>
			<span class="sk-time"><ImageSkeleton /></span>
		</span>
	</div>
{/snippet}

{#snippet cardContent(image: ResourceImageRecord, index: number)}
	{@const settled = settledImageKeys.includes(image.image.key)}
	<span class="image-frame">
		<BlurFillImage
			src={image.image.url}
			alt={ti('resources.imageAlt', { order: index + 1 })}
			onSettled={() => settleImage(image.image.key)}
		/>
	</span>
	{#if settled}
		<span class="card-footer">
			<span class="roles" id={`resource-roles-${index}`}>
				{#each image.roles as role (role)}
					<span class="role">{t(resourceRoleLabels[role])}</span>
				{/each}
			</span>
			<time
				datetime={new Date(image.createdAt).toISOString()}
				aria-label={ti('resources.createdAt', {
					date: formatCreatedAt(image.createdAt),
					time: formatCreatedAtTime(image.createdAt)
				})}
			>
				<span>{formatCreatedAt(image.createdAt)}</span>
				<span>{formatCreatedAtTime(image.createdAt)}</span>
			</time>
		</span>
	{:else}
		<span class="card-footer" aria-hidden="true">
			<span class="sk-pill"><ImageSkeleton /></span>
			<span class="sk-time"><ImageSkeleton /></span>
		</span>
	{/if}
{/snippet}

<svelte:head>
	<title>{t('resources.title')}</title>
</svelte:head>

<main class="resources-page" aria-labelledby="resources-title">
	<section class="resources-shell">
		<header class="resources-header">
			<h1 id="resources-title">{t('resources.title')}</h1>
			<p>{t('resources.subtitle')}</p>
		</header>

		<div class="filter-toggle" role="tablist" aria-label={t('resources.filter.label')}>
			{#each resourceFilters as option, index (option)}
				<button
					{@attach (node) => {
						filterTabs[index] = node as HTMLElement;
					}}
					type="button"
					role="tab"
					id={`resources-filter-${option}`}
					aria-selected={filter === option}
					aria-controls="resources-panel"
					tabindex={filter === option ? 0 : -1}
					class:active={filter === option}
					onclick={() => filterTabController.activate(index)}
					onkeydown={filterTabController.onKeydown}
				>
					{t(filterLabels[option])}
				</button>
			{/each}
		</div>

		<div
			class="resources-panel"
			role="tabpanel"
			id="resources-panel"
			aria-labelledby={`resources-filter-${filter}`}
		>
			{#if resources.status === 'loading'}
				<ul class="grid" aria-busy="true" aria-label={t('resources.loading')}>
					{#each [0, 1, 2, 3, 4, 5] as slot (slot)}
						<li class="card">{@render cardSkeleton()}</li>
					{/each}
				</ul>
			{:else if resources.status === 'error' && resources.images.length === 0}
				<p class="status error" role="alert">{t('resources.failed')}</p>
			{:else if resources.images.length === 0}
				<p class="status">{t(emptyLabels[filter])}</p>
			{:else}
				<ul class="grid" aria-label={t('resources.listLabel')}>
					{#each resources.images as image, index (image.image.key)}
						<li class="card">
							<a
								class="card-body card-link"
								href={resolve('/resources/[key]', { key: encodeURIComponent(image.image.key) })}
								aria-label={ti('resources.openAria', { order: index + 1 })}
								aria-describedby={settledImageKeys.includes(image.image.key)
									? `resource-roles-${index}`
									: undefined}
							>
								{@render cardContent(image, index)}
							</a>
						</li>
					{/each}
					{#if resources.loadingMore}
						{#each [0, 1, 2] as slot (`more-${slot}`)}
							<li class="card">{@render cardSkeleton()}</li>
						{/each}
					{/if}
				</ul>

				{#if resources.hasMore}
					<div bind:this={loadMoreSentinel} class="load-more-sentinel">
						{#if resources.loadingMore}
							<p class="visually-hidden" aria-live="polite">{t('resources.loadingMore')}</p>
						{/if}
					</div>
				{/if}
				{#if resources.status === 'error'}
					<p class="status error" role="alert">{t('resources.failed')}</p>
				{/if}
			{/if}
		</div>
	</section>
</main>

<style>
	.resources-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.resources-shell {
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

	.resources-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	h1,
	.resources-header p,
	.status {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.resources-header p,
	.status {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.error {
		color: var(--color-danger);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.card {
		display: flex;
	}

	.filter-toggle {
		display: flex;
		align-self: flex-start;
		gap: 0.5rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 12px;
	}

	.filter-toggle button {
		padding: 0.5rem 1.25rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.filter-toggle button:hover:not(.active) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.filter-toggle button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
	}

	.resources-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.card-body {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		overflow: hidden;
		font: inherit;
		text-align: left;
	}

	.card-link {
		cursor: pointer;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			transform 0.15s;
	}

	.card-link:hover,
	.card-link:focus-visible {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
	}

	.image-frame {
		position: relative;
		display: block;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: var(--color-skeleton);
	}

	.sk-pill,
	.sk-time {
		position: relative;
		display: block;
		height: 0.875rem;
		overflow: hidden;
		border-radius: 999px;
	}

	.sk-pill {
		width: 4.75rem;
	}

	.sk-time {
		width: 7rem;
	}

	.card-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.roles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.role {
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
		color: var(--color-accent-text);
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.card-footer time {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		color: var(--color-muted);
		font-size: 0.75rem;
	}

	.card-footer time span + span::before {
		content: '·';
		margin-right: 0.45rem;
	}

	.load-more-sentinel {
		min-height: 3rem;
		display: flex;
		align-items: center;
	}

	@media (max-width: 720px) {
		.resources-page {
			padding: 1rem;
		}

		.resources-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}

		.grid {
			grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		}
	}
</style>
