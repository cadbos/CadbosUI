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
	import { X } from '@lucide/svelte';
	import { page } from '$app/state';
	import type { ProjectSessionRecord } from '$lib/api/contract';
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';
	import { shareViewer } from '$lib/state/share-viewer.svelte';

	const token = $derived(page.params.token);

	let lightbox = $state<{ generationId: string; alt: string } | null>(null);
	const lightboxImage = $derived.by(() => {
		const selected = lightbox;
		if (!selected || !shareViewer.project) return null;
		const generation = shareViewer.project.sessions
			.flatMap((session) => session.generations)
			.find((candidate) => candidate.id === selected.generationId);
		return generation ? { url: generation.image.url, alt: selected.alt } : null;
	});

	$effect(() => {
		void shareViewer.load(token);
		return () => shareViewer.clear();
	});

	function formatDate(timestamp: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(timestamp));
	}

	function sessionTitle(session: ProjectSessionRecord): string {
		return session.title.trim() !== '' ? session.title : t('share.sessionUntitled');
	}

	function parentTitle(
		session: ProjectSessionRecord,
		sessions: ProjectSessionRecord[]
	): string | null {
		if (!session.parentSessionId) return null;
		const parent = sessions.find((s) => s.id === session.parentSessionId);
		return parent ? sessionTitle(parent) : null;
	}

	function openModal(dialog: HTMLDialogElement): () => void {
		dialog.showModal();
		return () => {
			if (dialog.open) dialog.close();
		};
	}

	function openLightbox(generationId: string, alt: string): void {
		lightbox = { generationId, alt };
	}

	function closeLightbox(): void {
		lightbox = null;
	}
</script>

<svelte:head>
	<title>{shareViewer.project?.title ?? t('share.title')}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="share-page" aria-labelledby="share-title">
	{#if shareViewer.status === 'loading'}
		<p class="status">{t('share.loading')}</p>
	{:else if shareViewer.status === 'not-found'}
		<p class="status error" role="alert">{t('share.notFound')}</p>
	{:else if shareViewer.status === 'error'}
		<p class="status error" role="alert">{t('share.failed')}</p>
	{:else if shareViewer.project}
		{@const project = shareViewer.project}
		<section class="share-shell">
			<header class="share-header">
				<h1 id="share-title">{project.title}</h1>
			</header>

			{#if project.sessions.length === 0}
				<p class="status">{t('share.sessionsEmpty')}</p>
			{:else}
				<ul class="sessions-grid">
					{#each project.sessions as session (session.id)}
						{@const forkedFrom = parentTitle(session, project.sessions)}
						<li class="session-card">
							<div class="session-body">
								<span class="session-title">{sessionTitle(session)}</span>
								{#if forkedFrom}
									<span class="session-forked"
										>{ti('share.sessionForkedFrom', { title: forkedFrom })}</span
									>
								{/if}
								<span class="session-updated"
									>{ti('share.sessionUpdatedAt', { date: formatDate(session.updatedAt) })}</span
								>
							</div>
							{#if session.generations.length > 0}
								<ul class="generations-grid" aria-label={t('share.generationsLabel')}>
									{#each session.generations as generation, index (generation.id)}
										{@const alt = ti('share.generationAlt', {
											order: index + 1,
											title: sessionTitle(session)
										})}
										<li>
											<button
												type="button"
												class="generation-thumb"
												aria-label={ti('share.generationOpenAria', {
													order: index + 1,
													title: sessionTitle(session)
												})}
												onclick={() => openLightbox(generation.id, alt)}
											>
												<img src={generation.image.url} {alt} loading="lazy" />
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if lightboxImage}
		{@const image = lightboxImage}
		<dialog
			class="lightbox-dialog"
			{@attach openModal}
			aria-label={image.alt}
			onclick={(event) => {
				if (event.target === event.currentTarget) closeLightbox();
			}}
			oncancel={(event) => {
				event.preventDefault();
				closeLightbox();
			}}
		>
			<button type="button" class="lightbox-close" onclick={closeLightbox}>
				<X size={18} strokeWidth={1.8} aria-hidden="true" />
				<span class="visually-hidden">{t('share.lightboxClose')}</span>
			</button>
			<img src={image.url} alt={image.alt} />
		</dialog>
	{/if}
</main>

<style>
	.share-page {
		width: 100%;
		min-height: 100dvh;
		padding: clamp(1rem, 2vw, 2rem);
	}

	.share-shell {
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: clamp(1rem, 2vw, 1.5rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}

	.share-header h1 {
		margin: 0;
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.status {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.error {
		color: var(--color-danger);
	}

	.sessions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.session-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		padding: 0.75rem;
	}

	.session-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.session-title {
		color: var(--color-text);
		font-weight: 650;
		font-size: 0.9375rem;
	}

	.session-forked,
	.session-updated {
		color: var(--color-muted);
		font-size: 0.75rem;
	}

	.generations-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
		gap: 0.5rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.generation-thumb {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		overflow: hidden;
		cursor: zoom-in;
		transition: border-color 0.15s;
	}

	.generation-thumb:hover,
	.generation-thumb:focus-visible {
		border-color: var(--color-accent);
	}

	.generation-thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.lightbox-dialog {
		width: min(94vw, 64rem);
		max-width: none;
		max-height: 90dvh;
		margin: auto;
		padding: 0;
		border: none;
		border-radius: var(--radius-lg);
		background: transparent;
		overflow: visible;
	}

	.lightbox-dialog::backdrop {
		background: rgb(29 29 31 / 0.72);
		backdrop-filter: blur(4px);
	}

	.lightbox-dialog img {
		display: block;
		width: 100%;
		max-height: 90dvh;
		border-radius: var(--radius-lg);
		object-fit: contain;
		background: var(--color-surface);
	}

	.lightbox-close {
		position: absolute;
		top: -0.75rem;
		right: -0.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-md);
		cursor: pointer;
	}

	.lightbox-close:hover,
	.lightbox-close:focus-visible {
		border-color: var(--color-accent);
		color: var(--color-accent-text);
	}

	@media (max-width: 720px) {
		.share-page {
			padding: 1rem;
		}

		.share-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}

		.lightbox-close {
			top: 0.5rem;
			right: 0.5rem;
		}
	}
</style>
