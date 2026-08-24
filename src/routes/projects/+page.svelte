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
	import { Trash2 } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import type { ProjectRecord } from '$lib/api/contract';
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';
	import { projects } from '$lib/state/projects.svelte';
	import { logBoundaryError } from '$lib/utils';

	let loadMoreSentinel = $state<HTMLElement | null>(null);
	let newTitle = $state('');
	let createError = $state<string | null>(null);
	let deleteTarget = $state<ProjectRecord | null>(null);
	let deleteError = $state<string | null>(null);

	function openModal(dialog: HTMLDialogElement): () => void {
		dialog.showModal();
		return () => {
			if (dialog.open) dialog.close();
		};
	}

	function requestDelete(project: ProjectRecord): void {
		deleteError = null;
		deleteTarget = project;
	}

	function cancelDelete(): void {
		deleteTarget = null;
	}

	async function confirmDelete(): Promise<void> {
		const project = deleteTarget;
		if (!project) return;
		try {
			await projects.archive(project.id);
			deleteTarget = null;
		} catch (error) {
			deleteError = t('projects.deleteFailed');
			logBoundaryError('projectsPage.confirmDelete', error);
		}
	}

	$effect(() => {
		void projects.load();
		return () => projects.clear();
	});

	$effect(() => {
		const sentinel = loadMoreSentinel;
		if (!sentinel) return;

		let intersecting = false;

		async function maybeLoadMore(): Promise<void> {
			if (!intersecting || !projects.hasMore || projects.loadingMore) return;
			await projects.loadMore();
			// A single page may not be enough to push the sentinel back out of
			// view (few results, a tall viewport) — IntersectionObserver only
			// fires on a *transition*, so re-check manually instead of waiting
			// for a transition that may never come.
			void maybeLoadMore();
		}

		const observer = new IntersectionObserver(
			(entries) => {
				intersecting = entries.some((entry) => entry.isIntersecting);
				void maybeLoadMore();
			},
			{ root: null, rootMargin: '0px 0px 240px 0px' }
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	});

	function formatUpdatedAt(updatedAt: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(updatedAt));
	}

	async function createProject(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const title = newTitle.trim();
		if (!title || projects.creating) return;
		createError = null;
		try {
			await projects.create(title);
			newTitle = '';
		} catch (error) {
			createError = t('projects.createFailed');
			logBoundaryError('projectsPage.createProject', error);
		}
	}
</script>

<svelte:head>
	<title>{t('projects.title')}</title>
</svelte:head>

<main class="projects-page" aria-labelledby="projects-title">
	<section class="projects-shell">
		<header class="projects-header">
			<h1 id="projects-title">{t('projects.title')}</h1>
			<p>{t('projects.subtitle')}</p>
		</header>

		<form class="create-form" onsubmit={createProject}>
			<label class="visually-hidden" for="new-project-title">{t('projects.createLabel')}</label>
			<input
				id="new-project-title"
				type="text"
				maxlength="200"
				placeholder={t('projects.createPlaceholder')}
				bind:value={newTitle}
				disabled={projects.creating}
			/>
			<button type="submit" disabled={projects.creating || newTitle.trim() === ''}>
				{projects.creating ? t('projects.creating') : t('projects.createButton')}
			</button>
		</form>
		{#if createError}
			<p class="status error" role="alert">{createError}</p>
		{/if}

		{#if projects.status === 'loading'}
			<p class="status">{t('projects.loading')}</p>
		{:else if projects.status === 'error' && projects.projects.length === 0}
			<p class="status error" role="alert">{t('projects.failed')}</p>
		{:else if projects.projects.length === 0}
			<p class="status">{t('projects.empty')}</p>
		{:else}
			<ul class="grid" aria-label={t('projects.listLabel')}>
				{#each projects.projects as project (project.id)}
					<li class="card">
						<a
							class="card-link"
							href={resolve('/projects/[id]', { id: project.id })}
							aria-label={ti('projects.openAria', { title: project.title })}
						>
							<span class="card-title">{project.title}</span>
							<span class="card-updated"
								>{ti('projects.updatedAt', {
									date: formatUpdatedAt(project.updatedAt)
								})}</span
							>
						</a>
						<button
							type="button"
							class="card-delete"
							aria-label={ti('projects.deleteButtonAria', { title: project.title })}
							disabled={projects.archivingId === project.id}
							onclick={() => requestDelete(project)}
						>
							<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
						</button>
					</li>
				{/each}
			</ul>

			{#if projects.hasMore}
				<div bind:this={loadMoreSentinel} class="load-more-sentinel">
					{#if projects.loadingMore}
						<p class="status" aria-live="polite">{t('projects.loadingMore')}</p>
					{/if}
				</div>
			{/if}
			{#if projects.status === 'error'}
				<p class="status error" role="alert">{t('projects.failed')}</p>
			{/if}
		{/if}
	</section>

	{#if deleteTarget}
		{@const project = deleteTarget}
		<dialog
			class="confirm-dialog"
			{@attach openModal}
			aria-labelledby="delete-project-title"
			aria-describedby="delete-project-description"
			oncancel={(event) => {
				event.preventDefault();
				cancelDelete();
			}}
		>
			<h3 id="delete-project-title">{t('projects.deleteConfirmTitle')}</h3>
			<p id="delete-project-description">{t('projects.deleteConfirmDescription')}</p>
			{#if deleteError}
				<p class="status error" role="alert">{deleteError}</p>
			{/if}
			<div class="confirm-actions">
				<button type="button" class="secondary-button" onclick={cancelDelete}>
					{t('projects.deleteConfirmCancel')}
				</button>
				<button
					type="button"
					class="primary-danger-button"
					disabled={projects.archivingId === project.id}
					onclick={confirmDelete}
				>
					{t('projects.deleteConfirmConfirm')}
				</button>
			</div>
		</dialog>
	{/if}
</main>

<style>
	.projects-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.projects-shell {
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

	.projects-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	h1,
	.projects-header p,
	.status {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.projects-header p,
	.status {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.error {
		color: var(--color-danger);
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

	.create-form {
		display: flex;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.create-form input {
		flex: 1 1 16rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
	}

	.create-form button {
		padding: 0.625rem 1.125rem;
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.create-form button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 1rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.card {
		display: flex;
		align-items: stretch;
		gap: 0.5rem;
		padding: 1rem 1.125rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			transform 0.15s;
	}

	.card:has(.card-link:hover),
	.card:has(.card-link:focus-visible) {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-md);
		transform: translateY(-2px);
	}

	.card-link {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.card-delete {
		flex: 0 0 auto;
		align-self: flex-start;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.card-delete:hover {
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		color: var(--color-danger);
	}

	.card-delete:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.card-title {
		color: var(--color-text);
		font-weight: 650;
		font-size: 1rem;
	}

	.card-updated {
		color: var(--color-muted);
		font-size: 0.8125rem;
	}

	.load-more-sentinel {
		min-height: 3rem;
		display: flex;
		align-items: center;
	}

	@media (max-width: 720px) {
		.projects-page {
			padding: 1rem;
		}

		.projects-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}

		.grid {
			grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		}
	}

	.confirm-dialog {
		width: min(100% - 2rem, 25rem);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: none;
		margin: auto;
		padding: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
	}

	.confirm-dialog::backdrop {
		background: rgb(29 29 31 / 0.32);
		backdrop-filter: blur(4px);
	}

	.confirm-dialog h3 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 650;
	}

	.confirm-dialog p {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.875rem;
		line-height: 1.4;
	}

	.confirm-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.secondary-button,
	.primary-danger-button {
		min-height: 2.5rem;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.secondary-button {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.secondary-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent-text);
	}

	.primary-danger-button {
		border: 1px solid var(--color-danger);
		background: var(--color-danger);
		color: white;
	}

	.primary-danger-button:hover {
		background: color-mix(in srgb, var(--color-danger) 86%, black);
	}

	.primary-danger-button:disabled,
	.secondary-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
