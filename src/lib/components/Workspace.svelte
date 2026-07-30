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
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import RenderResult from '$lib/components/RenderResult.svelte';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import PromptViews from '$lib/components/PromptViews.svelte';
	import StyleTransferPanel from '$lib/components/StyleTransferPanel.svelte';
	import GeneratedImagesSidebar from '$lib/components/GeneratedImagesSidebar.svelte';
	import {
		creditErrorKey,
		extractApiErrorCode,
		request,
		type SceneType
	} from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import type { OutputFormat, RenderResult as RenderResultType } from '$lib/state/request.svelte';
	import {
		applyShareParams,
		buildShareUrl,
		routeIdToMode,
		subTabFromSearch,
		type Mode
	} from '$lib/state/url-state';
	import { createTabController, logBoundaryError } from '$lib/utils';

	const modes: { id: Exclude<Mode, 'edit'>; label: TranslationKey }[] = [
		{ id: 'render', label: 'mode.render' },
		{ id: 'styleTransfer', label: 'mode.styleTransfer' }
	];

	const sceneTypes: { id: SceneType; label: TranslationKey }[] = [
		{ id: 'interior', label: 'render.sceneType.interior' },
		{ id: 'exterior', label: 'render.sceneType.exterior' }
	];

	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let modeTabs = $state<HTMLElement[]>([]);
	let sceneTypeTabs = $state<HTMLElement[]>([]);

	// The URL is the source of truth for which mode is open — not local $state —
	// so a shared link or a page reload always opens on the right tab.
	const mode = $derived(routeIdToMode(page.route.id));
	const activeMode = $derived(mode === 'styleTransfer' ? 'styleTransfer' : 'render');
	const hasActiveEditJob = $derived(
		request.activeObjectReplacementJobId !== undefined ||
			request.activeTextureReplacementJobId !== undefined
	);
	const syncMode = $derived(
		mode === 'edit' &&
			request.currentRender === undefined &&
			request.image !== undefined &&
			!hasActiveEditJob
			? 'render'
			: mode
	);
	const projectStep = $derived(
		hasActiveEditJob || request.currentRender ? 2 : request.image ? 1 : 0
	);

	const modeTabController = createTabController({
		itemCount: () => modes.length,
		getActiveIndex: () => modes.findIndex((m) => m.id === activeMode),
		setActiveIndex: (index) => {
			return goto(buildShareUrl(modes[index].id, request), {
				replaceState: false,
				keepFocus: true,
				noScroll: true
			}).catch((error: unknown) => logBoundaryError('workspace.modeNavigation', error));
		},
		focusTab: (index) => modeTabs[index]?.focus()
	});

	async function continueEditing(): Promise<void> {
		try {
			await goto(buildShareUrl('edit', request, { tool: 'freeform' }), {
				replaceState: false,
				keepFocus: true,
				noScroll: true
			});
			const editPanel = document.querySelector<HTMLElement>('#project-edit-panel');
			const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			editPanel?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
			editPanel?.focus({ preventScroll: true });
		} catch (error) {
			logBoundaryError('workspace.continueEditing', error);
		}
	}

	async function startNewPhoto(): Promise<void> {
		request.setCurrentRender(undefined);
		submitError = null;
		try {
			await goto(buildShareUrl('render', request, { view: 'chat' }), {
				replaceState: false,
				keepFocus: false,
				noScroll: false
			});
		} catch (error) {
			logBoundaryError('workspace.startNewPhoto', error);
		}
	}

	const sceneTypeTabController = createTabController({
		itemCount: () => sceneTypes.length,
		getActiveIndex: () => sceneTypes.findIndex((s) => s.id === request.sceneType),
		setActiveIndex: (index) => {
			request.setSceneType(sceneTypes[index].id);
		},
		focusTab: (index) => sceneTypeTabs[index]?.focus()
	});

	const isAuthenticated = $derived(auth.status === 'authenticated');
	const validation = $derived(request.validate());
	const canGenerate = $derived(validation.valid && !submitting && request.status !== 'rendering');
	const uploadLabel = $derived(
		request.sceneType === 'exterior' ? t('upload.labelExterior') : t('upload.label')
	);

	function generatedImagesEffect(): void {
		if (auth.canLoadGeneratedImages) void generatedImages.load();
		else generatedImages.clear();
	}

	$effect(generatedImagesEffect);

	// True once the request store has been hydrated from the URL at least once
	// (see afterNavigate below). Gates the write-sync effect so it can't fire —
	// and overwrite the shared link's query string with defaults — before that
	// initial hydration has run.
	let hydrated = $state(false);

	// afterNavigate also runs once when this component mounts (type 'enter'), so
	// it covers both the initial load of a shared link and later browser
	// back/forward or external-link navigation. It only ever fires client-side,
	// after hydration has already reconciled against the server-rendered HTML —
	// unlike a synchronous call in the component body, applying URL state here
	// can't cause a hydration mismatch. 'goto' is deliberately excluded: that's
	// the type of the navigations *we* trigger below and in the tab controllers,
	// where `request` is already the source of truth and re-parsing the URL
	// would be redundant.
	afterNavigate(({ type }) => {
		if (type === 'enter' || type === 'popstate' || type === 'link') {
			applyShareParams(mode, page.params.scene, page.url.searchParams, request);
		}
		hydrated = true;
	});

	// Keeps the URL in sync with the current mode/request so the address bar is
	// always a shareable link for what's on screen. Debounced so typing in a
	// prompt fragment doesn't rewrite the URL on every keystroke.
	//
	// The synchronous `buildShareUrl(mode, request)` call below (result
	// discarded) exists purely so this effect *tracks* mode/request as
	// dependencies and re-schedules the timer whenever they change — that's
	// what makes the debounce reactive at all. The URL actually used to
	// navigate is rebuilt fresh *inside* the timeout instead of reusing that
	// value, for two reasons: the sub-tab (view/tool/reference) has no backing
	// store field, so it can only be read off the current query string (a
	// plain DOM read, not a reactive `page` read, so it can't turn this effect
	// into a feedback loop with the `goto()` call below); and reusing a value
	// computed up front would go stale if the user changes the sub-tab (e.g.
	// clicks the Graph tab) while a request-field debounce from a moment
	// earlier is still pending — the timer would then fire with the *old*
	// sub-tab and clobber the switch by navigating back to it.
	function urlSyncEffect(): void | (() => void) {
		if (!hydrated) return;
		buildShareUrl(syncMode, request);
		const timer = setTimeout(() => {
			const currentSearch = new URLSearchParams(window.location.search);
			const url = buildShareUrl(syncMode, request, subTabFromSearch(syncMode, currentSearch));
			if (`${window.location.pathname}${window.location.search}` !== url) {
				goto(url, { replaceState: true, keepFocus: true, noScroll: true }).catch((error: unknown) =>
					logBoundaryError('workspace.urlSync', error)
				);
			}
		}, 400);
		return () => clearTimeout(timer);
	}

	$effect(urlSyncEffect);

	async function generate(): Promise<void> {
		if (!canGenerate) return;
		submitting = true;
		submitError = null;
		request.setStatus('rendering');
		const overlayId = generationOverlay.start('generationOverlay.render');
		try {
			const body = request.toRenderRequest();
			const endpoint = request.sceneType === 'exterior' ? '/api/render/exterior' : '/api/render';
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				throw new Error(await extractApiErrorCode(response, 'render_failed'));
			}
			const result = await response.json();
			const render: RenderResultType = {
				id: crypto.randomUUID(),
				outputUrls: [result.outputUrl],
				cost: result.cost,
				balance: result.balance,
				ts: Date.now()
			};
			request.setCurrentRender(render);
			request.setStatus('idle');
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
		} catch (err) {
			request.setStatus('error');
			submitError = t(renderErrorKey(err));
		} finally {
			submitting = false;
			generationOverlay.stop(overlayId);
		}
	}

	function renderErrorKey(err: unknown): TranslationKey {
		return creditErrorKey(
			{
				failed: 'render.failed',
				insufficientCredit: 'render.insufficientCredit',
				generationRestricted: 'render.generationRestricted'
			},
			err
		);
	}
</script>

{#snippet boundaryFailed(_error: unknown, reset: () => void)}
	<p class="boundary-failed">{t('boundary.failed')}</p>
	<button type="button" class="boundary-retry" onclick={reset}>
		{t('boundary.retry')}
	</button>
{/snippet}

<main class="page">
	<div class="workspace-shell">
		<div class="workspace-main">
			<nav class="mode-nav" aria-label={t('mode.switcher.label')}>
				<div class="mode-tabs" role="tablist" aria-label={t('mode.switcher.label')}>
					{#each modes as modeOption, index (modeOption.id)}
						<button
							{@attach (node) => {
								modeTabs[index] = node as HTMLElement;
							}}
							type="button"
							role="tab"
							id={`mode-tab-${modeOption.id}`}
							aria-selected={activeMode === modeOption.id}
							aria-controls={`mode-panel-${modeOption.id}`}
							tabindex={activeMode === modeOption.id ? 0 : -1}
							class:active={activeMode === modeOption.id}
							onclick={() => modeTabController.activate(index)}
							onkeydown={modeTabController.onKeydown}
						>
							<span>{t(modeOption.label)}</span>
						</button>
					{/each}
				</div>
			</nav>

			{#if activeMode === 'render'}
				<header class="project-intro">
					<p class="project-kicker">{t('mode.render')}</p>
					<h1>{t('project.title')}</h1>
					<p>{t('project.subtitle')}</p>
				</header>

				<ol class="project-progress" aria-label={t('project.progressLabel')}>
					<li
						class:current={projectStep === 0}
						aria-current={projectStep === 0 ? 'step' : undefined}
					>
						<span class="progress-marker" aria-hidden="true">1</span>
						<span>{t('project.stepSource')}</span>
					</li>
					<li
						class:current={projectStep === 1}
						aria-current={projectStep === 1 ? 'step' : undefined}
					>
						<span class="progress-marker" aria-hidden="true">2</span>
						<span>{t('project.stepCreate')}</span>
					</li>
					<li
						class:current={projectStep === 2}
						aria-current={projectStep === 2 ? 'step' : undefined}
					>
						<span class="progress-marker" aria-hidden="true">3</span>
						<span>{t('project.stepEdit')}</span>
					</li>
				</ol>
			{/if}

			<div
				class="mode-panel"
				role="tabpanel"
				id="mode-panel-render"
				aria-labelledby="mode-tab-render"
				tabindex="0"
				hidden={activeMode !== 'render'}
			>
				{#if request.currentRender}
					<section class="result-stage" aria-labelledby="project-result-title">
						<div class="stage-heading">
							<span class="stage-number" aria-hidden="true">2</span>
							<div>
								<h2 id="project-result-title">{t('project.resultTitle')}</h2>
								<p>{t('project.resultDescription')}</p>
							</div>
						</div>
						<svelte:boundary
							failed={boundaryFailed}
							onerror={(error: unknown) => logBoundaryError('workspace.renderResult', error)}
						>
							<RenderResult
								onContinueEditing={() => void continueEditing()}
								onStartNewPhoto={() => void startNewPhoto()}
							/>
						</svelte:boundary>
					</section>
				{/if}

				{#if request.currentRender || hasActiveEditJob}
					<section
						class="edit-stage"
						id="project-edit-panel"
						tabindex="-1"
						aria-labelledby="project-edit-title"
					>
						<div class="stage-heading">
							<span class="stage-number" aria-hidden="true">3</span>
							<div>
								<h2 id="project-edit-title">{t('project.editTitle')}</h2>
								<p>{t('project.editDescription')}</p>
							</div>
						</div>
						<svelte:boundary
							failed={boundaryFailed}
							onerror={(error: unknown) => logBoundaryError('workspace.editPanel', error)}
						>
							<EditPanel />
						</svelte:boundary>
					</section>
				{:else}
					<section class="step-card source-stage" aria-labelledby="project-source-title">
						<div class="step-header">
							<span class="step-num" aria-hidden="true">1</span>
							<div class="step-copy">
								<h2 id="project-source-title">{uploadLabel}</h2>
								<p>{t('project.sourceHint')}</p>
							</div>
						</div>

						<div class="scene-type-toggle" role="tablist" aria-label={t('render.sceneType.label')}>
							{#each sceneTypes as sceneTypeOption, index (sceneTypeOption.id)}
								<button
									{@attach (node) => {
										sceneTypeTabs[index] = node as HTMLElement;
									}}
									type="button"
									role="tab"
									aria-selected={request.sceneType === sceneTypeOption.id}
									tabindex={request.sceneType === sceneTypeOption.id ? 0 : -1}
									class:active={request.sceneType === sceneTypeOption.id}
									onclick={() => sceneTypeTabController.activate(index)}
									onkeydown={sceneTypeTabController.onKeydown}
								>
									{t(sceneTypeOption.label)}
								</button>
							{/each}
						</div>
						<ImageUpload />
					</section>

					{#if request.image}
						<div class="creation-stage">
							<PromptViews
								stepLabel="2"
								headingKey="project.stepCreate"
								optionalBadgeKey="render.optional"
							/>

							<section class="step-card generate-section">
								<label class="format-label">
									<span class="format-text">{t('render.outputFormat')}</span>
									<select
										value={request.outputFormat}
										onchange={(event) =>
											request.setOutputFormat(event.currentTarget.value as OutputFormat)}
										class="format-select"
									>
										<option value="webp">WebP</option>
										<option value="jpg">JPG</option>
										<option value="png">PNG</option>
										<option value="avif">AVIF</option>
									</select>
								</label>

								{#if !isAuthenticated}
									<p class="auth-hint">{t('render.signInToGenerate')}</p>
								{/if}

								<button
									type="button"
									class="generate-btn"
									disabled={!canGenerate || !isAuthenticated}
									onclick={() => void generate()}
								>
									{#if request.status === 'rendering'}
										<span class="spinner" aria-hidden="true"></span>
										{t('render.generating')}
									{:else}
										{t('render.generate')}
									{/if}
								</button>

								{#if submitError}
									<p class="submit-error" role="alert">{submitError}</p>
								{/if}
							</section>
						</div>
					{:else}
						<section class="locked-stage" aria-labelledby="project-locked-title">
							<span class="lock-mark" aria-hidden="true">2–3</span>
							<div>
								<h2 id="project-locked-title">{t('project.lockedTitle')}</h2>
								<p>{t('project.lockedDescription')}</p>
							</div>
						</section>
					{/if}
				{/if}
			</div>

			<div
				class="mode-panel"
				role="tabpanel"
				id="mode-panel-styleTransfer"
				aria-labelledby="mode-tab-styleTransfer"
				tabindex="0"
				hidden={activeMode !== 'styleTransfer'}
			>
				<svelte:boundary
					failed={boundaryFailed}
					onerror={(error: unknown) => logBoundaryError('workspace.styleTransfer', error)}
				>
					<StyleTransferPanel />
				</svelte:boundary>
			</div>
		</div>

		{#if isAuthenticated}
			<GeneratedImagesSidebar />
		{/if}
	</div>
</main>

<style>
	.page {
		min-height: 100dvh;
		padding: 2rem 1rem 4rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		/* Unchanged up to ~890px viewport (640px is the floor); on tablet/desktop it
		   fills the screen minus a comfortable side margin — the graph view in
		   particular benefits from the extra room — capped well above any real
		   monitor width so it never gets absurd on an ultrawide display. */
		--content-width: clamp(640px, calc(100vw - 4rem), 1800px);
	}

	.workspace-shell {
		width: 100%;
		max-width: calc(var(--content-width) + 368px + 1.5rem);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 1.5rem;
	}

	.workspace-main {
		width: 100%;
		max-width: var(--content-width);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		min-width: 0;
	}

	.project-intro {
		width: 100%;
		display: grid;
		gap: 0.45rem;
		padding: clamp(1.25rem, 3vw, 2rem);
		color: var(--color-text);
		background:
			linear-gradient(120deg, rgb(255 255 255 / 0.92), rgb(244 247 244 / 0.86)),
			var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.project-intro h1,
	.project-intro p,
	.stage-heading h2,
	.stage-heading p,
	.step-copy h2,
	.step-copy p,
	.locked-stage h2,
	.locked-stage p {
		margin: 0;
	}

	.project-intro h1 {
		max-width: 22ch;
		font-size: clamp(1.55rem, 4vw, 2.5rem);
		line-height: 1.05;
		letter-spacing: -0.035em;
	}

	.project-intro > p:last-child {
		max-width: 68ch;
		color: var(--color-text);
		line-height: 1.55;
	}

	.project-kicker {
		font-size: 0.75rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-accent);
	}

	.project-progress {
		width: 100%;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		overflow: hidden;
	}

	.project-progress li {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		min-width: 0;
		padding: 0.7rem 1rem;
		font-size: 0.8125rem;
		font-weight: 650;
		color: var(--color-muted-strong);
	}

	.project-progress li + li::before {
		content: '';
		position: absolute;
		inset-block: 25%;
		left: 0;
		width: 1px;
		background: var(--color-border);
	}

	.project-progress li.current {
		color: var(--color-accent-contrast);
		background: var(--color-text);
	}

	.progress-marker,
	.stage-number,
	.lock-mark {
		display: inline-grid;
		place-items: center;
		flex: 0 0 auto;
		font-variant-numeric: tabular-nums;
	}

	.progress-marker {
		width: 1.55rem;
		height: 1.55rem;
		font-size: 0.75rem;
		border: 1px solid currentColor;
		border-radius: 999px;
	}

	.mode-nav {
		width: 100%;
		padding: 0.25rem;
		background: #e9ece9;
		border: 1px solid #d8ded8;
		border-radius: 14px;
	}

	.mode-tabs {
		display: flex;
		gap: 0.5rem;
	}

	.mode-tabs button {
		flex: 1;
		min-width: 0;
		padding: 0.7rem 1.5rem;
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.2;
		text-align: center;
		color: #3f4d43;
		background: transparent;
		border: none;
		border-radius: 10px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			box-shadow 0.15s;
	}

	.mode-tabs button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
	}

	.mode-tabs button:hover:not(.active) {
		color: var(--color-accent);
		background: rgb(255 255 255 / 0.7);
	}

	.mode-tabs button.active {
		color: var(--color-accent-contrast);
		background: var(--color-text);
		box-shadow: var(--shadow-sm);
	}

	.mode-tabs button.active:focus-visible {
		outline-color: var(--color-text);
	}

	.mode-panel {
		/* .workspace-main uses align-items: center, so a flex child needs an
		   explicit width to stretch across the available content area. */
		width: 100%;
		display: flex;
		flex-direction: column;
		/* Matches .result-wrap's gap on the Edit tab — the create steps are now
		   separate cards too, stacked the same way. */
		gap: 1.5rem;
	}

	.mode-panel[hidden] {
		display: none;
	}

	.source-stage,
	.creation-stage,
	.result-stage,
	.edit-stage {
		width: 100%;
	}

	.source-stage {
		display: grid;
		gap: 1rem;
	}

	.step-copy,
	.stage-heading {
		display: grid;
		gap: 0.3rem;
	}

	.step-copy p,
	.stage-heading p,
	.locked-stage p {
		color: var(--color-muted-strong);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.creation-stage {
		display: grid;
		gap: 1rem;
	}

	.result-stage,
	.edit-stage {
		display: grid;
		gap: 1rem;
	}

	.result-stage {
		padding: clamp(0.75rem, 2vw, 1.25rem);
		background: #edf0ed;
		border: 1px solid #d9dfd9;
		border-radius: calc(var(--radius-lg) + 4px);
	}

	.edit-stage {
		padding: clamp(1rem, 2.5vw, 1.5rem);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		scroll-margin-top: 1rem;
	}

	.edit-stage:focus-visible {
		outline: 3px solid var(--color-accent);
		outline-offset: 3px;
	}

	.stage-heading {
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
	}

	.stage-number {
		width: 2rem;
		height: 2rem;
		font-size: 0.8125rem;
		font-weight: 750;
		color: var(--color-accent-contrast);
		background: var(--color-text);
		border-radius: 999px;
	}

	.locked-stage {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 1rem;
		width: 100%;
		padding: 1.25rem;
		background: color-mix(in srgb, var(--color-background) 82%, var(--color-surface));
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}

	.lock-mark {
		min-width: 2.7rem;
		height: 2.7rem;
		padding-inline: 0.5rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-muted-strong);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 999px;
	}

	.scene-type-toggle {
		display: flex;
		gap: 0.5rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 12px;
	}

	.scene-type-toggle button {
		flex: 1;
		padding: 0.5rem 1.25rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-muted-strong);
		background: transparent;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.scene-type-toggle button:hover:not(.active) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.scene-type-toggle button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
	}

	@media (max-width: 960px) {
		.workspace-shell {
			flex-direction: column;
			align-items: center;
		}
	}

	@media (max-width: 640px) {
		.page {
			--content-width: 100%;
			padding: 1.5rem 1rem 3rem;
		}

		.mode-tabs button {
			padding: 0.7rem 0.75rem;
			font-size: 0.875rem;
		}

		.project-progress {
			border-radius: var(--radius-lg);
		}

		.project-progress li {
			flex-direction: column;
			gap: 0.35rem;
			padding: 0.7rem 0.35rem;
			font-size: 0.7rem;
			text-align: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mode-tabs button,
		.scene-type-toggle button {
			transition: none;
		}
	}
</style>
