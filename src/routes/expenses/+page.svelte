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
	import type { CreditTransaction } from '$lib/api/contract';
	import { getLocale, t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { fetchProjectDetail } from '$lib/state/project-detail.svelte';
	import { request } from '$lib/state/request.svelte';
	import {
		buildShareUrl,
		destinationForGenerationKind,
		withProjectSession
	} from '$lib/state/url-state';
	import { initializeGenerationPreview, workspaceTabs } from '$lib/state/workspace-tabs.svelte';
	import { logBoundaryError } from '$lib/utils';

	const generationKindKeys: Record<CreditTransaction['kind'], TranslationKey> = {
		render: 'generatedImages.kind.render',
		edit: 'generatedImages.kind.edit',
		'style-transfer': 'generatedImages.kind.styleTransfer',
		'object-replacement': 'generatedImages.kind.objectReplacement',
		'texture-replacement': 'generatedImages.kind.textureReplacement',
		'light-settings': 'generatedImages.kind.lightSettings',
		upscale: 'generatedImages.kind.upscale'
	};

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
			hourCycle: 'h23'
		}).format(new Date(createdAt));
	}

	let openError = $state<string | null>(null);

	// Opens the workspace on the exact project/session/generation this expense
	// row paid for, seeded with its before/after (see
	// workspace-tabs.svelte.ts's initializeGenerationPreview). A project,
	// session, or generation that no longer resolves (e.g. an archived
	// project) surfaces openError instead of silently doing nothing — the
	// underlying record is still real billed history, so the row itself
	// stays in the list; only the "open it" affordance can fail.
	async function openGeneration(entry: CreditTransaction): Promise<void> {
		if (!entry.projectId || !entry.sessionId) return;
		openError = null;
		try {
			const project = await fetchProjectDetail(entry.projectId);
			if (!project) {
				openError = t('expenses.openFailed');
				return;
			}
			const session = project.sessions.find((candidate) => candidate.id === entry.sessionId);
			if (!session) {
				openError = t('expenses.openFailed');
				return;
			}
			const generation = session.generations.find((candidate) => candidate.id === entry.id);
			if (!generation) {
				openError = t('expenses.openFailed');
				return;
			}

			workspaceTabs.openProject({
				projectId: project.id,
				projectTitle: project.title,
				sessionId: session.id,
				sessionTitle: session.title.trim() === '' ? null : session.title,
				initialize: (state) => initializeGenerationPreview(state, project.id, session, generation)
			});

			const destination = destinationForGenerationKind(generation.kind);
			await goto(
				withProjectSession(
					buildShareUrl(destination.mode, request, destination.subTab),
					project.id,
					session.id,
					generation.id
				),
				{ replaceState: false }
			);
		} catch (error) {
			openError = t('expenses.openFailed');
			logBoundaryError('expensesPage.openGeneration', error);
		}
	}
</script>

<svelte:head>
	<title>{t('expenses.title')}</title>
</svelte:head>

<main class="expenses-page" aria-labelledby="expenses-title">
	<section class="expenses-shell">
		<header class="expenses-header">
			<h1 id="expenses-title">{t('expenses.title')}</h1>
			<p>{t('expenses.subtitle')}</p>
			{#if openError}
				<p class="status error" role="alert">{openError}</p>
			{/if}
		</header>

		{#if auth.status !== 'authenticated'}
			<p class="status">{t('expenses.signInRequired')}</p>
		{:else}
			{@const credit = auth.credit}
			{#if !credit || credit.history.length === 0}
				<p class="status">{t('auth.credit.historyEmpty')}</p>
			{:else}
				<div class="expenses-columns-header">
					<span>{t('expenses.column.date')}</span>
					<span>{t('expenses.column.time')}</span>
					<span class="value-cell">{t('expenses.column.value')}</span>
					<span>{t('expenses.column.action')}</span>
				</div>

				<ul class="history-list" aria-label={t('auth.credit.history')}>
					{#each credit.history as entry (entry.id)}
						<li>
							{#if entry.projectId && entry.sessionId}
								<button type="button" class="history-entry" onclick={() => openGeneration(entry)}>
									<span class="cell">{formatDate(entry.createdAt)}</span>
									<span class="cell">{formatTime(entry.createdAt)}</span>
									<span class="cell value-cell">{currency.format(entry.amount)}</span>
									<span class="cell">{t(generationKindKeys[entry.kind])}</span>
								</button>
							{:else}
								<span class="history-entry">
									<span class="cell">{formatDate(entry.createdAt)}</span>
									<span class="cell">{formatTime(entry.createdAt)}</span>
									<span class="cell value-cell">{currency.format(entry.amount)}</span>
									<span class="cell">{t(generationKindKeys[entry.kind])}</span>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>
</main>

<style>
	.expenses-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.expenses-shell {
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

	.expenses-header {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	h1,
	.expenses-header p,
	.status {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.expenses-header p,
	.status {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.status.error {
		color: var(--color-danger);
	}

	.expenses-columns-header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: minmax(7rem, 1.4fr) minmax(5rem, 0.9fr) minmax(5rem, 0.9fr) minmax(
				8rem,
				1.8fr
			);
		align-items: center;
		gap: 2rem;
		padding: 0 0.75rem 0.5rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
	}

	.expenses-columns-header span {
		color: var(--color-muted);
		font-size: 0.6875rem;
		font-weight: 650;
		letter-spacing: 0.045em;
		white-space: nowrap;
		text-transform: uppercase;
	}

	.expenses-columns-header .value-cell {
		text-align: right;
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.history-list li {
		display: flex;
	}

	.history-entry {
		display: grid;
		grid-template-columns: minmax(7rem, 1.4fr) minmax(5rem, 0.9fr) minmax(5rem, 0.9fr) minmax(
				8rem,
				1.8fr
			);
		align-items: center;
		gap: 2rem;
		width: 100%;
		padding: 0.875rem 0.75rem;
		font: inherit;
		text-align: left;
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.cell {
		overflow: hidden;
		color: var(--color-muted);
		font-size: 0.875rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.value-cell {
		color: var(--color-text);
		font-weight: 650;
		text-align: right;
	}

	.history-entry .cell:last-child {
		color: var(--color-text);
	}

	button.history-entry {
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	button.history-entry:hover,
	button.history-entry:focus-visible {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
	}

	@media (max-width: 720px) {
		.expenses-page {
			padding: 1rem;
		}

		.expenses-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}

		.expenses-columns-header,
		.history-entry {
			grid-template-columns: 5.5rem 4rem minmax(4.5rem, 0.9fr) minmax(0, 1.2fr);
			gap: 0.75rem;
		}

		.expenses-columns-header span {
			white-space: normal;
		}
	}
</style>
