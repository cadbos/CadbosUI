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
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type {
		GenerationKind,
		ProjectSessionRecord,
		PublicFormSnapshot,
		ShareGenerationDetailResponse
	} from '$lib/api/contract';
	import BlurFillImage from '$lib/components/BlurFillImage.svelte';
	import ImageSkeleton from '$lib/components/ImageSkeleton.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import ProjectStats from '$lib/components/ProjectStats.svelte';
	import SkeletonBlock from '$lib/components/SkeletonBlock.svelte';
	import { getLocale, t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { LIGHT_SETTINGS_PRESETS } from '$lib/light-settings-presets';
	import { createRevealTimers } from '$lib/reveal-on-timeout';
	import { shareViewer } from '$lib/state/share-viewer.svelte';
	import { logBoundaryError } from '$lib/utils';

	const token = $derived(page.params.token);
	const generationId = $derived(page.params.generationId);
	const generationCount = $derived(
		shareViewer.project?.sessions.reduce((sum, session) => sum + session.generations.length, 0) ?? 0
	);
	let settledThumbs = $state<string[]>([]);

	function settleThumb(id: string): void {
		if (settledThumbs.includes(id)) return;
		settledThumbs = [...settledThumbs, id];
	}

	const revealTimers = createRevealTimers();

	$effect(() => {
		return () => revealTimers.clear();
	});

	$effect(() => {
		const sessions = shareViewer.project?.sessions ?? [];
		const pending = sessions
			.filter((session) =>
				session.generations.some((generation) => !settledThumbs.includes(generation.id))
			)
			.map((session) => session.id);
		revealTimers.retain(pending, (sessionId) => {
			const session = shareViewer.project?.sessions.find((item) => item.id === sessionId);
			if (!session) return;
			for (const generation of session.generations) settleThumb(generation.id);
		});
	});

	const OUTPUT_FORMAT_LABELS: Record<PublicFormSnapshot['outputFormat'], string> = {
		webp: 'WebP',
		jpg: 'JPG',
		png: 'PNG',
		avif: 'AVIF'
	};

	interface SettingsRow {
		label: string;
		value: string;
	}

	// Text-only, per-kind summary of what produced this generation — deliberately
	// terser than the owner's own editable form: this is a read-only preview for
	// someone who can't act on any of it (see PublicFormSnapshot for what the
	// server already stripped before this ever reached the client).
	function formatSettingsRows(detail: ShareGenerationDetailResponse): SettingsRow[] {
		const snapshot = detail.formSnapshot;
		if (!snapshot) return [];
		const rows: SettingsRow[] = [];
		const kind: GenerationKind = detail.kind;
		if (kind === 'render') {
			const prompt =
				snapshot.promptOverride ??
				[...snapshot.promptFragments]
					.sort((a, b) => a.order - b.order)
					.map((fragment) => fragment.text)
					.join(' ');
			if (prompt.trim() !== '')
				rows.push({ label: t('share.settingsPrompt'), value: prompt.trim() });
			rows.push({
				label: t('render.outputFormat'),
				value: OUTPUT_FORMAT_LABELS[snapshot.outputFormat]
			});
		} else if (kind === 'edit') {
			if (snapshot.editPrompt.trim() !== '') {
				rows.push({ label: t('edit.instruction'), value: snapshot.editPrompt });
			}
			if (
				snapshot.editOperationType === 'add-object' &&
				snapshot.addObjectInstruction.trim() !== ''
			) {
				rows.push({
					label: t('edit.addObject.customLabel'),
					value: snapshot.addObjectInstruction
				});
			}
		} else if (kind === 'style-transfer') {
			if (snapshot.styleTransferPrompt.trim() !== '') {
				rows.push({ label: t('styleTransfer.guidance'), value: snapshot.styleTransferPrompt });
			}
			rows.push({
				label: t('styleTransfer.strength'),
				value: `${Math.round(snapshot.styleTransferStrength * 100)}%`
			});
			if (snapshot.styleNegativePrompt.trim() !== '') {
				rows.push({
					label: t('styleTransfer.negativePrompt'),
					value: snapshot.styleNegativePrompt
				});
			}
		} else if (kind === 'object-replacement') {
			if (snapshot.objectReplacementObject.trim() !== '') {
				rows.push({
					label: t('objectReplacement.objectLabel'),
					value: snapshot.objectReplacementObject
				});
			}
			rows.push({
				label: t('objectReplacement.scale'),
				value: `${Math.round(snapshot.objectReplacementScale * 100)}%`
			});
		} else if (kind === 'texture-replacement') {
			if (snapshot.textureReplacementMasked) {
				rows.push({
					label: t('textureReplacement.maskImage'),
					value: t('textureReplacement.maskedLabel')
				});
			} else if (snapshot.textureReplacementSurface.trim() !== '') {
				rows.push({
					label: t('textureReplacement.surfaceLabel'),
					value: snapshot.textureReplacementSurface
				});
			}
		} else if (kind === 'light-settings') {
			const presetLabels = snapshot.lightSettingsPresetIds
				.map((id) => LIGHT_SETTINGS_PRESETS.find((preset) => preset.id === id)?.label)
				.filter((label): label is TranslationKey => label !== undefined)
				.map((label) => t(label));
			if (presetLabels.length > 0) {
				rows.push({ label: t('lightSettings.moodSectionLabel'), value: presetLabels.join(', ') });
			}
			if (snapshot.lightSettingsInstruction.trim() !== '') {
				rows.push({
					label: t('lightSettings.customLabel'),
					value: snapshot.lightSettingsInstruction
				});
			}
		} else if (kind === 'repaint') {
			if (snapshot.repaintTarget.trim() !== '') {
				rows.push({ label: t('repaint.targetLabel'), value: snapshot.repaintTarget });
			}
			rows.push({ label: t('repaint.colorLabel'), value: snapshot.repaintColor });
		}
		return rows;
	}

	const lightboxImage = $derived.by(() => {
		const id = generationId;
		const project = shareViewer.project;
		if (!id || !project) return null;
		for (const session of project.sessions) {
			const index = session.generations.findIndex((generation) => generation.id === id);
			const generation = session.generations[index];
			if (!generation) continue;
			return {
				url: generation.image.url,
				alt: ti('share.generationAlt', { order: index + 1, title: sessionTitle(session) })
			};
		}
		return null;
	});
	const settingsRows = $derived(
		shareViewer.generationDetail ? formatSettingsRows(shareViewer.generationDetail) : []
	);

	$effect(() => {
		const currentToken = token;
		void shareViewer.load(currentToken);
		return () => {
			shareViewer.clear();
			shareViewer.clearGenerationDetail();
		};
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

	let openedFromList = false;

	function openLightbox(id: string): void {
		const replaceState = generationId !== undefined;
		if (!replaceState) openedFromList = true;
		void goto(resolve('/share/[token]/[[generationId=uuid]]', { token, generationId: id }), {
			noScroll: true,
			replaceState
		}).catch((error: unknown) => logBoundaryError('sharePage.openGeneration', error));
	}

	function closeLightbox(): void {
		if (openedFromList) {
			openedFromList = false;
			history.back();
			return;
		}
		void goto(resolve('/share/[token]/[[generationId=uuid]]', { token }), {
			replaceState: true,
			noScroll: true
		}).catch((error: unknown) => logBoundaryError('sharePage.closeGeneration', error));
	}

	$effect(() => {
		const id = generationId;
		const image = lightboxImage;
		const currentToken = token;
		if (!id || shareViewer.status !== 'ready' || image || !shareViewer.project) return;
		void goto(resolve('/share/[token]/[[generationId=uuid]]', { token: currentToken }), {
			replaceState: true,
			noScroll: true
		}).catch((error: unknown) => logBoundaryError('sharePage.unknownGeneration', error));
	});

	$effect(() => {
		const id = generationId;
		const image = lightboxImage;
		const currentToken = token;
		if (!id || !image) return;
		void shareViewer.loadGenerationDetail(currentToken, id);
		return () => shareViewer.clearGenerationDetail();
	});
</script>

{#snippet shareSessionSkeleton()}
	<li class="session-card" aria-hidden="true">
		<span class="session-body">
			<SkeletonBlock width="58%" height="0.95rem" />
			<SkeletonBlock width="42%" height="0.75rem" />
			<SkeletonBlock width="36%" height="0.75rem" />
		</span>
		<span class="generations-grid">
			{#each [0, 1, 2] as thumb (thumb)}
				<span class="generation-thumb">
					<ImageSkeleton />
				</span>
			{/each}
		</span>
	</li>
{/snippet}

<svelte:head>
	<title>{shareViewer.project?.title ?? t('share.title')}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="share-page" aria-labelledby="share-title">
	{#if shareViewer.status === 'loading'}
		<section class="share-shell" aria-busy="true" aria-label={t('share.loading')}>
			<header class="share-header">
				<SkeletonBlock width="14rem" height="1.6rem" />
				<SkeletonBlock width="10rem" height="0.75rem" />
			</header>
			<ul class="sessions-grid">
				{#each [0, 1] as slot (slot)}
					{@render shareSessionSkeleton()}
				{/each}
			</ul>
		</section>
	{:else if shareViewer.status === 'not-found'}
		<p class="status error" role="alert">{t('share.notFound')}</p>
	{:else if shareViewer.status === 'error'}
		<p class="status error" role="alert">{t('share.failed')}</p>
	{:else if shareViewer.project}
		{@const project = shareViewer.project}
		<section class="share-shell">
			<header class="share-header">
				<h1 id="share-title">{project.title}</h1>
				<ProjectStats sessionCount={project.sessions.length} {generationCount} />
			</header>

			{#if project.sessions.length === 0}
				<p class="status">{t('share.sessionsEmpty')}</p>
			{:else}
				<ul class="sessions-grid">
					{#each project.sessions as session (session.id)}
						{@const forkedFrom = parentTitle(session, project.sessions)}
						{@const ready =
							session.generations.length === 0 ||
							session.generations.every((generation) => settledThumbs.includes(generation.id))}
						<li class="session-card">
							{#if ready}
								<div class="session-body">
									<span class="session-title">{sessionTitle(session)}</span>
									{#if forkedFrom}
										<span class="session-forked"
											>{ti('share.sessionForkedFrom', { title: forkedFrom })}</span
										>
									{/if}
									<ProjectStats
										generationCount={session.generations.length}
										--project-stats-font-size="0.75rem"
									/>
									<span class="session-updated"
										>{ti('share.sessionUpdatedAt', { date: formatDate(session.updatedAt) })}</span
									>
								</div>
							{:else}
								<div class="session-body" aria-hidden="true">
									<SkeletonBlock width="58%" height="0.95rem" />
									<SkeletonBlock width="42%" height="0.75rem" />
									<SkeletonBlock width="36%" height="0.75rem" />
								</div>
							{/if}
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
												onclick={() => openLightbox(generation.id)}
											>
												<BlurFillImage
													src={generation.image.url}
													{alt}
													onSettled={() => settleThumb(generation.id)}
												/>
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
			<div class="lightbox-body">
				<LazyImage src={image.url} alt={image.alt} loading="eager" fetchPriority="high" />
				<div class="lightbox-settings" aria-live="polite">
					{#if shareViewer.generationDetailStatus === 'loading'}
						<div class="sk-lines" aria-hidden="true">
							<SkeletonBlock width="40%" height="0.9rem" />
							<SkeletonBlock height="0.75rem" />
							<SkeletonBlock width="88%" height="0.75rem" />
							<SkeletonBlock width="72%" height="0.75rem" />
						</div>
						<p class="visually-hidden" aria-live="polite">{t('share.settingsLoading')}</p>
					{:else if shareViewer.generationDetailStatus === 'error'}
						<p class="status error" role="alert">{t('share.settingsFailed')}</p>
					{:else if shareViewer.generationDetailStatus === 'ready'}
						{#if settingsRows.length > 0}
							<h2>{t('share.settingsTitle')}</h2>
							<dl class="settings-list">
								{#each settingsRows as row (row.label)}
									<div class="settings-row">
										<dt>{row.label}</dt>
										<dd>{row.value}</dd>
									</div>
								{/each}
							</dl>
						{:else}
							<p class="status">{t('share.settingsEmpty')}</p>
						{/if}
					{/if}
				</div>
			</div>
		</dialog>
	{/if}
</main>

<style>
	.share-page {
		width: 100%;
		min-height: calc(100dvh - var(--app-chrome-height, 0px));
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

	.share-header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
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
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-skeleton);
		overflow: hidden;
		cursor: zoom-in;
		transition: border-color 0.15s;
	}

	.generation-thumb:hover,
	.generation-thumb:focus-visible {
		border-color: var(--color-accent);
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

	.sk-lines {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
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

	.lightbox-body {
		--image-height: auto;
		--image-position: static;
		--image-img-height: auto;
		--image-max-height: 70dvh;
		--image-fit: contain;
		--image-bg: var(--color-surface);
		--image-min-height: 12rem;
		display: flex;
		flex-direction: column;
		max-height: 90dvh;
		overflow-y: auto;
		border-radius: var(--radius-lg);
	}

	.lightbox-settings {
		flex: 0 0 auto;
		padding: 1rem 1.25rem 1.25rem;
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		border-radius: 0 0 var(--radius-lg) var(--radius-lg);
	}

	.lightbox-settings h2 {
		margin: 0 0 0.625rem;
		color: var(--color-text);
		font-size: 0.9375rem;
		font-weight: 650;
	}

	.settings-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
	}

	.settings-row {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.settings-row dt {
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.settings-row dd {
		margin: 0;
		color: var(--color-text);
		font-size: 0.875rem;
		line-height: 1.4;
		white-space: pre-wrap;
	}

	.lightbox-close {
		position: absolute;
		z-index: 1;
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
