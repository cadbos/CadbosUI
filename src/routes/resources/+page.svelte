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
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';
	import { resources } from '$lib/state/resources.svelte';
	import { request } from '$lib/state/request.svelte';
	import { buildShareUrl } from '$lib/state/url-state';
	import { SCRATCH_TAB_ID, workspaceTabs } from '$lib/state/workspace-tabs.svelte';
	import { logBoundaryError } from '$lib/utils';

	let loadMoreSentinel = $state<HTMLElement | null>(null);

	$effect(() => {
		void resources.load();
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

	function useImage(sourceUrl: string): void {
		// A resource picked here is fresh, project-less work — it belongs on
		// the scratch tab, not whatever project tab happened to be active.
		// Without this, the mutations below would land on the shared `request`
		// singleton while it's still standing in for that other tab, silently
		// detaching *its* session and replacing its content with this image.
		workspaceTabs.activate(SCRATCH_TAB_ID);
		request.setImage({ url: sourceUrl });
		request.setCurrentRender(undefined);
		request.clearProjectSession();
		request.setStyleSourceMode('room-photo');
		request.setObjectReplacementSourceMode('room-photo');
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureMaskImage(undefined);
		request.setActiveObjectReplacementJobId(undefined);
		request.setActiveTextureReplacementJobId(undefined);
		request.setStatus('idle');
		goto(buildShareUrl('render', request, { view: 'chat' }), { replaceState: false }).catch(
			(error: unknown) => logBoundaryError('resourcesPage.imageNavigation', error)
		);
	}
</script>

<svelte:head>
	<title>{t('resources.title')}</title>
</svelte:head>

<main class="resources-page" aria-labelledby="resources-title">
	<section class="resources-shell">
		<header class="resources-header">
			<h1 id="resources-title">{t('resources.title')}</h1>
			<p>{t('resources.subtitle')}</p>
		</header>

		{#if resources.status === 'loading'}
			<p class="status">{t('resources.loading')}</p>
		{:else if resources.status === 'error' && resources.images.length === 0}
			<p class="status error" role="alert">{t('resources.failed')}</p>
		{:else if resources.images.length === 0}
			<p class="status">{t('resources.empty')}</p>
		{:else}
			<ul class="grid" aria-label={t('resources.listLabel')}>
				{#each resources.images as image, index (image.sourceUrl)}
					<li class="card">
						<button
							type="button"
							class="card-button"
							aria-label={ti('resources.useImageAria', { order: index + 1 })}
							onclick={() => useImage(image.sourceUrl)}
						>
							<span class="image-frame">
								<img
									src={image.sourceUrl}
									alt={ti('resources.imageAlt', { order: index + 1 })}
									loading="lazy"
								/>
							</span>
							<span class="card-footer">
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
						</button>
					</li>
				{/each}
			</ul>

			{#if resources.hasMore}
				<div bind:this={loadMoreSentinel} class="load-more-sentinel">
					{#if resources.loadingMore}
						<p class="status" aria-live="polite">{t('resources.loadingMore')}</p>
					{/if}
				</div>
			{/if}
			{#if resources.status === 'error'}
				<p class="status error" role="alert">{t('resources.failed')}</p>
			{/if}
		{/if}
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

	.card-button {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		overflow: hidden;
		cursor: pointer;
		font: inherit;
		text-align: left;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			transform 0.15s;
	}

	.card-button:hover,
	.card-button:focus-visible {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
	}

	.image-frame {
		display: block;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
	}

	.image-frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.card-footer {
		display: flex;
		align-items: center;
		padding: 0.625rem 0.75rem;
		border-top: 1px solid var(--color-border);
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
