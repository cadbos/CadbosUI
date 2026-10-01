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
	import type { GenerationKind } from '$lib/api/contract';
	import BlurFillImage from '$lib/components/BlurFillImage.svelte';
	import { getLocale, t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { resourceRoleLabels } from '$lib/resource-roles';
	import { openGenerationInWorkspace } from '$lib/state/open-generation';
	import { request } from '$lib/state/request.svelte';
	import { resourceDetail } from '$lib/state/resource-detail.svelte';
	import { buildShareUrl } from '$lib/state/url-state';
	import { SCRATCH_TAB_ID, workspaceTabs } from '$lib/state/workspace-tabs.svelte';
	import { logBoundaryError } from '$lib/utils';

	const generationKindKeys: Record<GenerationKind, TranslationKey> = {
		render: 'generatedImages.kind.render',
		edit: 'generatedImages.kind.edit',
		'style-transfer': 'generatedImages.kind.styleTransfer',
		'object-replacement': 'generatedImages.kind.objectReplacement',
		'texture-replacement': 'generatedImages.kind.textureReplacement',
		'light-settings': 'generatedImages.kind.lightSettings',
		upscale: 'generatedImages.kind.upscale'
	};

	const key = $derived(page.params.key ?? '');

	let openingId = $state<string | null>(null);
	let openFailed = $state(false);

	$effect(() => {
		void resourceDetail.load(key);
		return () => resourceDetail.clear();
	});

	function observeLoadMore(sentinel: HTMLElement): () => void {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void resourceDetail.loadMore();
			},
			{ root: null, rootMargin: '0px 0px 240px 0px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}

	function formatDate(createdAt: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(createdAt));
	}

	function formatTime(createdAt: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		}).format(new Date(createdAt));
	}

	// Starting fresh from a source photo is project-less work — it belongs on
	// the scratch tab, not whatever project tab happened to be active.
	// Without switching first, the mutations below would land on the shared
	// `request` singleton while it's still standing in for that other tab,
	// silently detaching *its* session and replacing its content.
	function startNewGeneration(mediaKey: string): void {
		workspaceTabs.activate(SCRATCH_TAB_ID);
		request.startFromImage({ mediaKey });
		request.clearProjectSession();
		goto(
			resolve(buildShareUrl('render', request, { view: 'chat' }) as PathnameWithSearchOrHash, {}),
			{ replaceState: false }
		).catch((error: unknown) => logBoundaryError('resourcePage.startNewGeneration', error));
	}

	async function openGeneration(id: string): Promise<void> {
		if (openingId) return;
		openingId = id;
		openFailed = false;
		try {
			if (!(await openGenerationInWorkspace(id))) openFailed = true;
		} catch (error) {
			openFailed = true;
			logBoundaryError('resourcePage.openGeneration', error);
		} finally {
			openingId = null;
		}
	}
</script>

<svelte:head>
	<title>{t('resources.detail.title')}</title>
</svelte:head>

<main class="resource-page" aria-labelledby="resource-title">
	<section class="resource-shell">
		<a class="back-link" href={resolve('/resources', {})}>{t('resources.detail.back')}</a>
		<h1 id="resource-title">{t('resources.detail.title')}</h1>

		{#if resourceDetail.status === 'loading'}
			<p class="status">{t('resources.loading')}</p>
		{:else if resourceDetail.status === 'not-found'}
			<p class="status">{t('resources.detail.notFound')}</p>
		{:else if resourceDetail.status === 'error' && !resourceDetail.image}
			<p class="status error" role="alert">{t('resources.detail.failed')}</p>
		{:else if resourceDetail.image}
			{@const image = resourceDetail.image}
			<div class="resource-summary">
				<span class="resource-image">
					<BlurFillImage src={image.url} alt={t('resources.detail.imageAlt')} loading="eager" />
				</span>
				<div class="resource-meta">
					<ul class="roles" aria-label={t('resources.detail.rolesLabel')}>
						{#each resourceDetail.roles as role (role)}
							<li class="role">{t(resourceRoleLabels[role])}</li>
						{/each}
					</ul>
					{#if resourceDetail.roles.includes('source')}
						<button
							type="button"
							class="primary-action"
							onclick={() => startNewGeneration(image.key)}
						>
							{t('resources.detail.startNewGeneration')}
						</button>
					{/if}
				</div>
			</div>

			<h2>{t('resources.detail.generations')}</h2>
			{#if resourceDetail.generations.length === 0}
				<p class="status">{t('resources.detail.empty')}</p>
			{:else}
				<ul class="grid" aria-label={t('resources.detail.generationsLabel')}>
					{#each resourceDetail.generations as generation, index (generation.id)}
						{@const session = generation.session}
						<li class="card">
							{#snippet cardContent()}
								<span class="image-frame">
									<BlurFillImage
										src={generation.image.url}
										alt={ti('resources.detail.resultAlt', { order: index + 1 })}
									/>
								</span>
								<span class="card-body">
									<span class="kind">{t(generationKindKeys[generation.kind])}</span>
									<span class="roles" id={`generation-roles-${index}`}>
										{#each generation.roles as role (role)}
											<span class="role">{t(resourceRoleLabels[role])}</span>
										{/each}
									</span>
									{#if session}
										<span class="session">
											{session.projectTitle} · {session.sessionTitle.trim() === ''
												? t('workspace.tabs.untitled')
												: session.sessionTitle}
										</span>
									{/if}
									{#if !session}
										<span class="note">{t('resources.detail.archived')}</span>
									{:else if !generation.settingsSaved}
										<span class="note">{t('resources.detail.settingsNotSaved')}</span>
									{/if}
									<time
										datetime={new Date(generation.createdAt).toISOString()}
										aria-label={ti('resources.detail.createdAt', {
											date: formatDate(generation.createdAt),
											time: formatTime(generation.createdAt)
										})}
									>
										<span>{formatDate(generation.createdAt)}</span>
										<span>{formatTime(generation.createdAt)}</span>
									</time>
								</span>
							{/snippet}
							{#if session && generation.settingsSaved}
								<button
									type="button"
									class="card-surface card-button"
									aria-label={ti('resources.detail.openAria', { order: index + 1 })}
									aria-describedby={`generation-roles-${index}`}
									aria-busy={openingId === generation.id}
									disabled={openingId !== null}
									onclick={() => openGeneration(generation.id)}
								>
									{@render cardContent()}
								</button>
							{:else}
								<div class="card-surface">
									{@render cardContent()}
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				{#if resourceDetail.hasMore}
					<div class="load-more-sentinel" {@attach observeLoadMore}>
						{#if resourceDetail.loadingMore}
							<p class="status" aria-live="polite">{t('resources.loadingMore')}</p>
						{/if}
					</div>
				{/if}
			{/if}
			{#if resourceDetail.status === 'error'}
				<p class="status error" role="alert">{t('resources.detail.failed')}</p>
			{/if}
			{#if openFailed}
				<p class="status error" role="alert">{t('resources.detail.openFailed')}</p>
			{/if}
		{/if}
	</section>
</main>

<style>
	.resource-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.resource-shell {
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

	.back-link {
		align-self: flex-start;
		color: var(--color-muted-strong);
		font-size: 0.875rem;
		text-decoration: none;
	}

	.back-link::before {
		content: '← ';
	}

	.back-link:hover {
		color: var(--color-text);
	}

	h1,
	h2,
	.status {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	h2 {
		color: var(--color-text);
		font-size: 1.0625rem;
		font-weight: 650;
	}

	.status {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.error {
		color: var(--color-danger);
	}

	.resource-summary {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 1rem;
	}

	.resource-image {
		display: block;
		width: min(100%, 22rem);
		aspect-ratio: 4 / 3;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
	}

	.resource-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.roles {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.role {
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
		color: var(--color-accent-text);
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.primary-action {
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	.primary-action:hover {
		background: var(--color-accent-hover);
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

	.card-surface {
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
		color: inherit;
	}

	.card-button {
		cursor: pointer;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			transform 0.15s;
	}

	.card-button:hover:not(:disabled),
	.card-button:focus-visible {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
	}

	.card-button:disabled {
		cursor: progress;
	}

	.image-frame {
		display: block;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
	}

	.card-body {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.625rem 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.kind {
		color: var(--color-text);
		font-size: 0.875rem;
		font-weight: 600;
	}

	.session {
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
	}

	.note {
		color: var(--color-muted);
		font-size: 0.8125rem;
		font-style: italic;
	}

	.card-body time {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		color: var(--color-muted);
		font-size: 0.75rem;
	}

	.card-body time span + span::before {
		content: '·';
		margin-right: 0.45rem;
	}

	.load-more-sentinel {
		min-height: 3rem;
		display: flex;
		align-items: center;
	}

	@media (max-width: 720px) {
		.resource-page {
			padding: 1rem;
		}

		.resource-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}

		.grid {
			grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		}
	}
</style>
