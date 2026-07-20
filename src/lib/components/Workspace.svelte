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
	import ObjectReplacementPanel from '$lib/components/ObjectReplacementPanel.svelte';
	import GeneratedImagesSidebar from '$lib/components/GeneratedImagesSidebar.svelte';
	import {
		creditErrorKey,
		extractApiErrorCode,
		request,
		type SceneType
	} from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import type { OutputFormat, RenderResult as RenderResultType } from '$lib/state/request.svelte';
	import {
		applyShareParams,
		buildShareUrl,
		routeIdToMode,
		subTabFromSearch,
		type Mode
	} from '$lib/state/url-state';
	import { createTabController, logBoundaryError } from '$lib/utils';

	const modes: { id: Mode; label: TranslationKey; alpha?: boolean }[] = [
		{ id: 'render', label: 'mode.render' },
		{ id: 'edit', label: 'mode.edit' },
		{ id: 'styleTransfer', label: 'mode.styleTransfer' },
		{ id: 'objectReplacement', label: 'mode.objectReplacement', alpha: true }
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

	$effect(() => {
		if (auth.canLoadGeneratedImages) void generatedImages.load();
		else generatedImages.clear();
	});

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
							{#if modeOption.alpha}
								<span class="mode-alpha">{t('objectReplacement.alpha')}</span>
							{/if}
						</button>
					{/each}
				</div>
			</nav>

			<div
				class="mode-panel"
				role="tabpanel"
				id="mode-panel-render"
				aria-labelledby="mode-tab-render"
				tabindex="0"
				hidden={mode !== 'render'}
			>
				<section class="step-card">
					<div class="step-header">
						<span class="step-num" aria-hidden="true">①</span>
						<h2>{t('render.sceneType.label')}</h2>
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
				</section>

				<section class="step-card">
					<div class="step-header">
						<span class="step-num" aria-hidden="true">②</span>
						<h2>{uploadLabel}</h2>
					</div>
					<ImageUpload />
				</section>

				<PromptViews
					stepLabel="③"
					headingKey="view.switcher.label"
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

			{#if request.currentRender}
				<section class="result-wrap" aria-label={t('render.result')}>
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

			<div
				class="result-wrap"
				role="tabpanel"
				id="mode-panel-edit"
				aria-labelledby="mode-tab-edit"
				tabindex="0"
				hidden={mode !== 'edit'}
			>
				{#if !request.currentRender}
					<section class="step-card">
						<div class="step-header">
							<span class="step-num" aria-hidden="true">①</span>
							<h2>{t('upload.label')}</h2>
						</div>
						<ImageUpload />
					</section>
				{/if}

				<section class="step-card">
					<div class="step-header">
						<span class="step-num" aria-hidden="true">
							{request.currentRender ? '①' : '②'}
						</span>
						<h2>{t('edit.title')}</h2>
					</div>
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
				</section>
			</div>

			<div
				class="mode-panel"
				role="tabpanel"
				id="mode-panel-styleTransfer"
				aria-labelledby="mode-tab-styleTransfer"
				tabindex="0"
				hidden={mode !== 'styleTransfer'}
			>
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

			<div
				class="mode-panel"
				role="tabpanel"
				id="mode-panel-objectReplacement"
				aria-labelledby="mode-tab-objectReplacement"
				tabindex="0"
				hidden={mode !== 'objectReplacement'}
			>
				<svelte:boundary
					onerror={(error: unknown) => logBoundaryError('workspace.objectReplacement', error)}
				>
					<ObjectReplacementPanel />
					{#snippet failed(_error: unknown, reset: () => void)}
						<p class="boundary-failed">{t('boundary.failed')}</p>
						<button type="button" class="boundary-retry" onclick={reset}>
							{t('boundary.retry')}
						</button>
					{/snippet}
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

	.mode-alpha {
		padding: 0.1rem 0.35rem;
		border: 1px solid currentColor;
		border-radius: 100px;
		font-size: 0.5625rem;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: 0.03em;
		text-transform: uppercase;
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

	.result-wrap {
		width: 100%;
		max-width: var(--content-width);
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.result-wrap[hidden] {
		display: none;
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
	}

	@media (max-width: 420px) {
		.mode-tabs {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
