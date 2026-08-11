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
	import { page } from '$app/state';
	import type { ProjectSessionRecord } from '$lib/api/contract';
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';
	import { shareViewer } from '$lib/state/share-viewer.svelte';

	const token = $derived(page.params.token);

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
						{@const latest = session.generations[0]}
						{@const forkedFrom = parentTitle(session, project.sessions)}
						<li class="session-card">
							{#if latest}
								<span class="session-thumb">
									<img
										src={latest.url}
										alt={ti('share.sessionThumbnailAlt', { title: sessionTitle(session) })}
										loading="lazy"
									/>
								</span>
							{/if}
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
						</li>
					{/each}
				</ul>
			{/if}
		</section>
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
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		overflow: hidden;
	}

	.session-thumb {
		display: block;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
	}

	.session-thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.session-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.75rem;
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

	@media (max-width: 720px) {
		.share-page {
			padding: 1rem;
		}

		.share-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}
	}
</style>
