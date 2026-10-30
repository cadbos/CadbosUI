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
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CompareSlider from '$lib/components/CompareSlider.svelte';
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { getLocale, t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { adminGeneration } from '$lib/state/admin-generation.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { formatGenerationKind } from '../../usage-format';
	import InspectionImage from './InspectionImage.svelte';
	import InspectionSettings from './InspectionSettings.svelte';

	let comparisonId = $state<string | null>(null);
	const detail = $derived(adminGeneration.detail);
	const comparing = $derived(comparisonId === detail?.id);
	const errorKey = $derived.by((): TranslationKey => {
		if (adminGeneration.status === 'unauthorized') return 'usage.signInRequired';
		if (adminGeneration.status === 'forbidden') return 'adminGeneration.forbidden';
		if (adminGeneration.status === 'not-found') return 'adminGeneration.notFound';
		return 'adminGeneration.failed';
	});
	const operation = $derived.by(() => {
		if (!detail) return '';
		const edit = detail.formSnapshot?.editOperationType;
		if (detail.kind === 'edit' && edit === 'add-object') return t('edit.tool.addObject');
		if (detail.kind === 'edit' && edit === 'remove-object') return t('edit.tool.removeObject');
		if (detail.kind === 'edit' && edit === 'freeform') return t('edit.tool.freeform');
		return formatGenerationKind(detail.kind);
	});
	function loadInspection(): () => void {
		const id = page.params.id;
		const pubkey = auth.pubkey;
		const authenticated = auth.status === 'authenticated';
		untrack(() => {
			if (authenticated && pubkey && id) void adminGeneration.load(id);
			else adminGeneration.clear();
		});
		return () => adminGeneration.clear();
	}
	$effect(loadInspection);
	function retry(): void {
		if (page.params.id) void adminGeneration.load(page.params.id);
	}
</script>

<svelte:head>
	<title>{t('adminGeneration.title')} — {t('app.title')}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<a class="back-link" href={resolve('/usage', {})}>{t('adminGeneration.back')}</a>
<header class="usage-header"><h1>{t('adminGeneration.title')}</h1></header>

{#if auth.status === 'restoring' || adminGeneration.status === 'loading'}
	<div class="loading" aria-busy="true" aria-label={t('adminGeneration.loading')}>
		<SkeletonBlock width="60%" height="1rem" />
		<SkeletonBlock height="20rem" radius="var(--radius)" />
	</div>
{:else if auth.status !== 'authenticated'}
	<p class="status error" role="alert">{t('usage.signInRequired')}</p>
{:else if adminGeneration.status !== 'ready' || !detail}
	<p class="status error" role="alert">{t(errorKey)}</p>
	{#if adminGeneration.status === 'error'}<button type="button" class="retry" onclick={retry}
			>{t('usage.generations.retry')}</button
		>{/if}
{:else}
	<dl class="metadata">
		<div>
			<dt>{t('usage.generations.column.id')}</dt>
			<dd>{detail.id}</dd>
		</div>
		<div>
			<dt>{t('adminGeneration.operation')}</dt>
			<dd>{operation}</dd>
		</div>
		<div>
			<dt>{t('usage.generations.column.time')}</dt>
			<dd>
				{new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
					detail.createdAt
				)}
			</dd>
		</div>
		<div>
			<dt>{t('adminGeneration.project')}</dt>
			<dd>
				{detail.project
					? detail.project.title.trim() || t('workspace.tabs.untitled')
					: t('adminGeneration.unavailable')}
			</dd>
		</div>
		<div>
			<dt>{t('adminGeneration.session')}</dt>
			<dd>
				{detail.session
					? detail.session.title.trim() || t('projects.detail.sessionUntitled')
					: t('adminGeneration.unavailable')}
			</dd>
		</div>
	</dl>
	<div class="inspection-layout">
		<div class="result-column">
			<section class="result" aria-labelledby="inspection-result-title">
				<div class="result-header">
					<h2 id="inspection-result-title">{t('usage.generations.column.result')}</h2>
					{#if detail.source && detail.image}<button
							type="button"
							aria-pressed={comparing}
							onclick={() => {
								comparisonId = comparing ? null : detail.id;
							}}>{t('toolbar.compare')}</button
						>{/if}
				</div>
				{#if comparing && detail.source && detail.image}
					<div class="comparison">
						<CompareSlider
							beforeSrc={detail.source.url}
							afterSrc={detail.image.url}
							beforeAlt={t('toolbar.before')}
							afterAlt={t('toolbar.after')}
							handleLabel={t('toolbar.compare')}
						/>
					</div>
				{:else}
					{#key detail.id}<InspectionImage
							src={detail.image?.url ?? null}
							alt={t('usage.generations.column.result')}
						/>{/key}
				{/if}
			</section>
			<section class="prompt" aria-labelledby="inspection-prompt-title">
				<h2 id="inspection-prompt-title">{t('adminGeneration.prompt')}</h2>
				<p>
					{detail.prompt ||
						(detail.kind === 'render' && detail.formSnapshot?.autoEnhance
							? t('render.autoEnhance.label')
							: t('adminGeneration.none'))}
				</p>
				{#if detail.translatedPrompt !== null}<h2>{t('adminGeneration.translatedPrompt')}</h2>
					<p>{detail.translatedPrompt || t('adminGeneration.none')}</p>{/if}
			</section>
		</div>
		<aside class="settings-column" aria-label={t('adminGeneration.settings')}>
			{#key detail.id}<InspectionSettings {detail} />{/key}
		</aside>
	</div>
{/if}

<style>
	.back-link {
		color: var(--color-primary);
		align-self: flex-start;
	}
	.loading {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.metadata {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 1rem;
		margin: 0;
	}
	dt {
		font-size: 0.75rem;
		color: var(--color-muted);
		font-weight: 650;
	}
	dd {
		margin: 0.35rem 0 0;
		overflow-wrap: anywhere;
		font-size: 0.875rem;
	}
	.inspection-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(17rem, 23rem);
		gap: 1.5rem;
		align-items: start;
	}
	.result-column,
	.settings-column {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}
	.settings-column {
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-background);
	}
	.result {
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	.result-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}
	button {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		background: var(--color-surface-hover);
	}
	.retry {
		align-self: center;
	}
	.prompt {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.prompt p {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.comparison {
		width: 100%;
		aspect-ratio: 4 / 3;
	}
	@media (max-width: 900px) {
		.inspection-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
