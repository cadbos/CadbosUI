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
	import { Images } from '@lucide/svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import RenderResult from '$lib/components/RenderResult.svelte';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import MaskEditor from '$lib/components/MaskEditor.svelte';
	import PromptViews from '$lib/components/PromptViews.svelte';
	import ScenesDrawer from '$lib/components/ScenesDrawer.svelte';
	import StyleTransferPanel from '$lib/components/StyleTransferPanel.svelte';
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
		slugToTool,
		subTabFromSearch,
		type Mode
	} from '$lib/state/url-state';
	import { createTabController, logBoundaryError } from '$lib/utils';

	const modes: { id: Mode; label: TranslationKey }[] = [
		{ id: 'render', label: 'mode.render' },
		{ id: 'edit', label: 'mode.edit' },
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
	let scenesOpen = $state(false);
	let scenesTrigger: HTMLButtonElement | null = null;

	// The URL is the source of truth for which mode is open — not local $state —
	// so a shared link or a page reload always opens on the right tab.
	const mode = $derived(routeIdToMode(page.route.id));

	const modeTabController = createTabController({
		itemCount: () => modes.length,
		getActiveIndex: () => modes.findIndex((m) => m.id === mode),
		setActiveIndex: (index) => {
			// No sub-tab passed: switching modes has no "current" sub-tab to carry
			// over from a different mode, so each mode opens on its own default.
			// Pushes a history entry (unlike the sub-tab/settings navigations
			// below) so Back/Forward actually steps through Create/Edit/Style
			// transfer/Object replacement, matching what a dedicated URL per mode implies.
			return goto(buildShareUrl(modes[index].id, request), {
				replaceState: false,
				keepFocus: true,
				noScroll: true
			}).catch((error: unknown) => logBoundaryError('workspace.modeNavigation', error));
		},
		focusTab: (index) => modeTabs[index]?.focus()
	});

	function activateMode(id: Mode): void {
		modeTabController.activate(modes.findIndex((m) => m.id === id));
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

	const activeEditTool = $derived(slugToTool(page.url.searchParams.get('tool') ?? undefined));

	// While drawing a texture-replacement mask, the canvas shows the mask
	// editor's own drawing surface instead of the plain upload/result — so the
	// user paints directly on the image they're already looking at, not a
	// duplicate copy inside the panel. `activeEditTool`/`request.textureReplacementMasked`
	// are enough to derive this without any prop-drilling through EditPanel.
	const showMaskOnCanvas = $derived(
		mode === 'edit' &&
			activeEditTool === 'texture-replacement' &&
			request.textureReplacementMasked &&
			!request.textureReplacementResultReady
	);
	const maskEditorLocked = $derived(
		request.textureMaskUploading || request.activeTextureReplacementJobId !== undefined
	);

	$effect(() => {
		if (auth.canLoadGeneratedImages) void generatedImages.load();
		else generatedImages.clear();
	});

	function closeScenes(): void {
		scenesOpen = false;
		requestAnimationFrame(() => scenesTrigger?.focus());
	}

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
	$effect(() => {
		if (!hydrated) return;
		buildShareUrl(mode, request);
		const timer = setTimeout(() => {
			const currentSearch = new URLSearchParams(window.location.search);
			const url = buildShareUrl(mode, request, subTabFromSearch(mode, currentSearch));
			if (`${window.location.pathname}${window.location.search}` !== url) {
				goto(url, { replaceState: true, keepFocus: true, noScroll: true }).catch((error: unknown) =>
					logBoundaryError('workspace.urlSync', error)
				);
			}
		}, 400);
		return () => clearTimeout(timer);
	});

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

<main class="page">
	<div class="workspace-shell">
		<div class="workspace-main">
			<div class="workspace-topbar">
				{#if isAuthenticated}
					<button
						{@attach (node) => {
							scenesTrigger = node as HTMLButtonElement;
							return () => {
								scenesTrigger = null;
							};
						}}
						type="button"
						class="scenes-button"
						aria-expanded={scenesOpen}
						aria-controls="scenes-drawer"
						onclick={() => (scenesOpen = true)}
					>
						<Images size={18} strokeWidth={1.8} aria-hidden="true" />
						<span>{t('generatedImages.title')}</span>
					</button>
				{/if}

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
								aria-selected={mode === modeOption.id}
								aria-controls={`mode-panel-${modeOption.id}`}
								tabindex={mode === modeOption.id ? 0 : -1}
								class:active={mode === modeOption.id}
								onclick={() => modeTabController.activate(index)}
								onkeydown={modeTabController.onKeydown}
							>
								<span>{t(modeOption.label)}</span>
							</button>
						{/each}
					</div>
				</nav>
			</div>

			<!-- Each mode keeps its own persistent canvas-layout (hidden via CSS, not
			     destroyed via {#if}) so that in-flight background work — the Object/
			     Texture Replacement tools' async job polling in particular — survives
			     switching away to another mode and back. All three share the same
			     `.canvas-layout` shape so the workspace footprint never changes
			     between modes. -->
			<div
				class="canvas-layout"
				role="tabpanel"
				id="mode-panel-render"
				aria-labelledby="mode-tab-render"
				tabindex="0"
				hidden={mode !== 'render'}
			>
				<div class="canvas-col">
					<h2 class="canvas-heading">{uploadLabel}</h2>
					<ImageUpload />
					{#if mode === 'render' && request.currentRender}
						<section aria-label={t('render.result')}>
							<svelte:boundary
								onerror={(error: unknown) => logBoundaryError('workspace.renderResult', error)}
							>
								<RenderResult onEditRequest={() => activateMode('edit')} />
								{#snippet failed(_error: unknown, reset: () => void)}
									<p class="boundary-failed">{t('boundary.failed')}</p>
									<button type="button" class="boundary-retry" onclick={reset}>
										{t('boundary.retry')}
									</button>
								{/snippet}
							</svelte:boundary>
						</section>
					{/if}
				</div>

				<div class="panel-col">
					<div class="step-card">
						<div class="panel-section">
							<h2 class="panel-heading">{t('render.sceneType.label')}</h2>
							<div
								class="scene-type-toggle"
								role="tablist"
								aria-label={t('render.sceneType.label')}
							>
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
						</div>

						<PromptViews
							stepLabel="③"
							headingKey="view.switcher.label"
							optionalBadgeKey="render.optional"
						/>

						<div class="panel-section generate-section">
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
						</div>
					</div>
				</div>
			</div>

			<div
				class="canvas-layout"
				role="tabpanel"
				id="mode-panel-edit"
				aria-labelledby="mode-tab-edit"
				tabindex="0"
				hidden={mode !== 'edit'}
			>
				<div class="canvas-col">
					{#if showMaskOnCanvas}
						<svelte:boundary
							onerror={(error: unknown) => logBoundaryError('workspace.maskEditor', error)}
						>
							<MaskEditor
								sourceUrl={request.textureReplacementSourceUrl()}
								disabled={maskEditorLocked}
							/>
							{#snippet failed(_error: unknown, reset: () => void)}
								<p class="boundary-failed">{t('boundary.failed')}</p>
								<button type="button" class="boundary-retry" onclick={reset}>
									{t('boundary.retry')}
								</button>
							{/snippet}
						</svelte:boundary>
					{:else if mode === 'edit' && !request.currentRender}
						<ImageUpload />
					{:else if mode === 'edit' && request.currentRender}
						<section aria-label={t('render.result')}>
							<svelte:boundary
								onerror={(error: unknown) => logBoundaryError('workspace.renderResult', error)}
							>
								<RenderResult onEditRequest={() => activateMode('edit')} />
								{#snippet failed(_error: unknown, reset: () => void)}
									<p class="boundary-failed">{t('boundary.failed')}</p>
									<button type="button" class="boundary-retry" onclick={reset}>
										{t('boundary.retry')}
									</button>
								{/snippet}
							</svelte:boundary>
						</section>
					{/if}
				</div>

				<div class="panel-col">
					<svelte:boundary
						onerror={(error: unknown) => logBoundaryError('workspace.editPanel', error)}
					>
						<EditPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="boundary-failed">{t('boundary.failed')}</p>
							<button type="button" class="boundary-retry" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			</div>

			<div
				class="canvas-layout"
				role="tabpanel"
				id="mode-panel-styleTransfer"
				aria-labelledby="mode-tab-styleTransfer"
				tabindex="0"
				hidden={mode !== 'styleTransfer'}
			>
				<div class="canvas-col">
					{#if mode === 'styleTransfer' && !request.currentRender}
						<ImageUpload />
					{:else if mode === 'styleTransfer' && request.currentRender}
						<section aria-label={t('render.result')}>
							<svelte:boundary
								onerror={(error: unknown) => logBoundaryError('workspace.renderResult', error)}
							>
								<RenderResult onEditRequest={() => activateMode('edit')} />
								{#snippet failed(_error: unknown, reset: () => void)}
									<p class="boundary-failed">{t('boundary.failed')}</p>
									<button type="button" class="boundary-retry" onclick={reset}>
										{t('boundary.retry')}
									</button>
								{/snippet}
							</svelte:boundary>
						</section>
					{/if}
				</div>

				<div class="panel-col">
					<svelte:boundary
						onerror={(error: unknown) => logBoundaryError('workspace.styleTransfer', error)}
					>
						<StyleTransferPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="boundary-failed">{t('boundary.failed')}</p>
							<button type="button" class="boundary-retry" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			</div>
		</div>
	</div>

	{#if isAuthenticated && scenesOpen}
		<ScenesDrawer onClose={closeScenes} />
	{/if}
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
		max-width: var(--content-width);
		display: flex;
		align-items: flex-start;
		justify-content: center;
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

	.workspace-topbar {
		width: 100%;
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		gap: 0.75rem;
	}

	/* Fixed to roughly the panel column's width (below) so the mode switcher
	   reads as part of that right-hand panel instead of a full-width header. */
	.mode-nav {
		flex: 0 0 360px;
		max-width: 100%;
		padding: 0.25rem;
		background: #e9ece9;
		border: 1px solid #d8ded8;
		border-radius: 14px;
	}

	.scenes-button {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 3rem;
		padding: 0.65rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-sm);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s,
			box-shadow 0.15s;
	}

	.scenes-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent);
		box-shadow: var(--shadow);
	}

	.mode-tabs {
		display: flex;
		gap: 0.375rem;
	}

	.mode-tabs button {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0.5rem;
		font: inherit;
		font-size: 0.8125rem;
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

	/* One shared container for all three modes — its *content* switches on
	   `mode`, so the canvas/panel footprint is identical everywhere instead of
	   each mode having its own independently-sized layout. */
	.canvas-layout {
		width: 100%;
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 1.5rem;
	}

	.canvas-col {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.panel-col {
		flex: 0 0 360px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.panel-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.canvas-heading,
	.panel-heading {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
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
		color: var(--color-muted);
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

	@media (max-width: 900px) {
		.canvas-layout {
			flex-direction: column;
		}

		.panel-col {
			flex-basis: auto;
			width: 100%;
		}

		.mode-nav {
			flex-basis: auto;
			width: 100%;
		}
	}

	@media (max-width: 440px) {
		.workspace-topbar {
			flex-direction: column;
		}
	}

	@media (max-width: 640px) {
		.page {
			--content-width: 100%;
			padding: 1.5rem 1rem 3rem;
		}

		.scenes-button {
			padding-inline: 0.75rem;
		}
	}
</style>
