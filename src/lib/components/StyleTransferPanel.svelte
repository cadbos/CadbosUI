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
	import { page } from '$app/state';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import type { OutputFormat, RenderResponse } from '$lib/api/contract';
	import {
		creditErrorKey,
		extractApiErrorCode,
		renderResultFromResponse,
		request,
		type SceneType,
		type ImageSourceMode
	} from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import { stylePresetsFor, type StylePreset } from '$lib/style-presets';
	import { buildShareUrl, slugToReference, type ReferenceTab } from '$lib/state/url-state';
	import { createTabController, logBoundaryError } from '$lib/utils';

	const REFERENCE_TABS: { id: ReferenceTab; label: TranslationKey }[] = [
		{ id: 'photorealistic', label: 'styleTransfer.referenceTabPhotorealistic' },
		{ id: 'conceptual', label: 'styleTransfer.referenceTabConceptual' },
		{ id: 'custom', label: 'styleTransfer.referenceTabCustom' }
	];

	const sceneTypes: { id: SceneType; label: TranslationKey }[] = [
		{ id: 'interior', label: 'render.sceneType.interior' },
		{ id: 'exterior', label: 'render.sceneType.exterior' }
	];

	let applying = $state(false);
	let error = $state<string | null>(null);
	// Only ever rendered in style transfer mode (see Workspace.svelte), so the
	// URL's `reference` query param is this component's tab state.
	const referenceTab = $derived(
		slugToReference(page.url.searchParams.get('reference') ?? undefined)
	);
	let referenceTabButtons = $state<HTMLElement[]>([]);
	let presetButtons = $state<HTMLElement[]>([]);
	let sceneTypeButtons = $state<HTMLElement[]>([]);

	const isAuthenticated = $derived(auth.status === 'authenticated');
	const validation = $derived(request.validateStyleTransfer());
	const canApply = $derived(validation.valid && !applying && request.status !== 'rendering');
	const currentResultUrl = $derived(request.currentRender?.outputUrls[0]);
	const usesCurrentResult = $derived(
		request.styleSourceMode === 'current-result' && currentResultUrl !== undefined
	);
	const strengthPercent = $derived(Math.round(request.styleTransferStrength * 100));
	const strengthTier = $derived.by((): TranslationKey => {
		if (request.styleTransferStrength <= 0.33) return 'styleTransfer.strengthSubtle';
		if (request.styleTransferStrength < 0.67) return 'styleTransfer.strengthBalanced';
		return 'styleTransfer.strengthStrong';
	});
	const strengthValueText = $derived(`${strengthPercent}% ${t(strengthTier)}`);
	const sourcePhotoLabel = $derived(
		request.sceneType === 'exterior' ? t('upload.labelExterior') : t('upload.label')
	);
	const currentPresets = $derived(
		referenceTab === 'custom' ? [] : stylePresetsFor(request.sceneType, referenceTab)
	);
	const selectedPresetId = $derived(
		currentPresets.find((preset) => preset.src === request.styleReferenceImage?.url)?.id ?? null
	);
	const activePresetIndex = $derived(
		Math.max(
			currentPresets.findIndex((preset) => preset.id === selectedPresetId),
			0
		)
	);

	const referenceTabs = createTabController({
		itemCount: () => REFERENCE_TABS.length,
		getActiveIndex: () => REFERENCE_TABS.findIndex((tab) => tab.id === referenceTab),
		setActiveIndex: (index) => {
			const nextTab = REFERENCE_TABS[index].id;
			if (nextTab !== referenceTab) clearReferenceSelection();
			return goto(buildShareUrl('styleTransfer', request, { reference: nextTab }), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}).catch((err: unknown) => logBoundaryError('styleTransferPanel.referenceNavigation', err));
		},
		focusTab: (index) => referenceTabButtons[index]?.focus()
	});

	const presetRadios = createTabController({
		itemCount: () => currentPresets.length,
		getActiveIndex: () => activePresetIndex,
		setActiveIndex: (index) => {
			selectPreset(currentPresets[index]);
		},
		focusTab: (index) => presetButtons[index]?.focus()
	});

	const sceneTypeTabs = createTabController({
		itemCount: () => sceneTypes.length,
		getActiveIndex: () => sceneTypes.findIndex((s) => s.id === request.sceneType),
		setActiveIndex: (index) => {
			if (referenceTab !== 'custom') clearReferenceSelection();
			request.setSceneType(sceneTypes[index].id);
		},
		focusTab: (index) => sceneTypeButtons[index]?.focus()
	});

	function clearReferenceSelection(): void {
		request.setStyleReferenceImage(undefined);
	}

	function selectPreset(preset: StylePreset): void {
		request.setStyleReferenceImage({
			url: preset.src,
			mime: preset.mime
		});
	}

	function inputNumber(event: Event): number {
		return event.currentTarget instanceof HTMLInputElement
			? Number(event.currentTarget.value)
			: request.styleTransferStrength;
	}

	function textareaValue(event: Event): string {
		return event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.value : '';
	}

	function setSourceMode(mode: ImageSourceMode): void {
		request.setStyleSourceMode(mode);
	}

	async function submit(): Promise<void> {
		if (!canApply || !isAuthenticated) return;
		const body = request.toStyleTransferRequest();
		if (!body) return;
		applying = true;
		error = null;
		request.setStatus('rendering');
		try {
			const response = await fetch('/api/style-transfer', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				throw new Error(await extractApiErrorCode(response, 'style_transfer_failed'));
			}
			const result = (await response.json()) as RenderResponse;
			request.setCurrentRender(renderResultFromResponse(result));
			request.setStatus('idle');
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
		} catch (err) {
			request.setStatus('error');
			error = t(styleTransferErrorKey(err));
		} finally {
			applying = false;
		}
	}

	function styleTransferErrorKey(err: unknown): TranslationKey {
		return creditErrorKey(
			{
				failed: 'styleTransfer.failed',
				insufficientCredit: 'styleTransfer.insufficientCredit',
				generationRestricted: 'styleTransfer.generationRestricted'
			},
			err
		);
	}
</script>

<section class="step-card">
	<div class="step-header">
		<span class="step-num" aria-hidden="true">①</span>
		<h2>{t('styleTransfer.sourceImage')}</h2>
	</div>

	<div class="image-grid">
		<div class="image-column">
			<div class="column-header">
				<h3>{t('styleTransfer.sourceImage')}</h3>
				{#if currentResultUrl}
					<div class="source-tabs" role="group" aria-label={t('styleTransfer.sourceImage')}>
						<button
							type="button"
							class:active={request.styleSourceMode === 'room-photo'}
							aria-pressed={request.styleSourceMode === 'room-photo'}
							onclick={() => setSourceMode('room-photo')}
						>
							{sourcePhotoLabel}
						</button>
						<button
							type="button"
							class:active={request.styleSourceMode === 'current-result'}
							aria-pressed={request.styleSourceMode === 'current-result'}
							onclick={() => setSourceMode('current-result')}
						>
							{t('styleTransfer.sourceCurrentResult')}
						</button>
					</div>
				{/if}
			</div>

			{#if usesCurrentResult}
				<div class="source-preview">
					<img src={currentResultUrl} alt={t('styleTransfer.sourceCurrentResult')} />
				</div>
			{:else}
				<ImageUpload label="styleTransfer.sourceImage" />
			{/if}
		</div>

		<div class="image-column">
			<div class="column-header">
				<h3>{t('styleTransfer.referenceImage')}</h3>
			</div>

			<div class="scene-type-toggle" role="tablist" aria-label={t('render.sceneType.label')}>
				{#each sceneTypes as sceneTypeOption, index (sceneTypeOption.id)}
					<button
						{@attach (node) => {
							sceneTypeButtons[index] = node as HTMLElement;
						}}
						type="button"
						role="tab"
						id={`style-scene-tab-${sceneTypeOption.id}`}
						aria-selected={request.sceneType === sceneTypeOption.id}
						aria-controls="style-reference-panel"
						tabindex={request.sceneType === sceneTypeOption.id ? 0 : -1}
						class:active={request.sceneType === sceneTypeOption.id}
						onclick={() => sceneTypeTabs.activate(index)}
						onkeydown={sceneTypeTabs.onKeydown}
					>
						{t(sceneTypeOption.label)}
					</button>
				{/each}
			</div>

			<div class="reference-tabs" role="tablist" aria-label={t('styleTransfer.referenceTabsLabel')}>
				{#each REFERENCE_TABS as tab, index (tab.id)}
					<button
						{@attach (node) => {
							referenceTabButtons[index] = node as HTMLElement;
						}}
						type="button"
						role="tab"
						id={`style-reference-tab-${tab.id}`}
						aria-selected={referenceTab === tab.id}
						aria-controls="style-reference-panel"
						tabindex={referenceTab === tab.id ? 0 : -1}
						class:active={referenceTab === tab.id}
						onclick={() => referenceTabs.activate(index)}
						onkeydown={referenceTabs.onKeydown}
					>
						{t(tab.label)}
					</button>
				{/each}
			</div>

			<div
				role="tabpanel"
				id="style-reference-panel"
				aria-labelledby={`style-scene-tab-${request.sceneType} style-reference-tab-${referenceTab}`}
				tabindex="0"
			>
				{#if referenceTab === 'custom'}
					<ImageUpload target="styleReference" />
				{:else if currentPresets.length === 0}
					<p class="presets-empty">{t('styleTransfer.presetsEmpty')}</p>
				{:else}
					<p class="presets-hint" id="style-presets-hint">{t('styleTransfer.presetsGridLabel')}</p>
					<div class="preset-grid" role="radiogroup" aria-labelledby="style-presets-hint">
						{#each currentPresets as preset, index (preset.id)}
							<button
								{@attach (node) => {
									presetButtons[index] = node as HTMLElement;
								}}
								type="button"
								role="radio"
								class="preset"
								class:selected={selectedPresetId === preset.id}
								aria-checked={selectedPresetId === preset.id}
								tabindex={index === activePresetIndex ? 0 : -1}
								onclick={() => presetRadios.activate(index)}
								onkeydown={presetRadios.onKeydown}
							>
								<img src={preset.src} alt={t(preset.label)} loading="lazy" />
								<span>{t(preset.label)}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</section>

<section class="step-card guidance-section">
	<div class="step-header">
		<span class="step-num" aria-hidden="true">②</span>
		<h2>{t('styleTransfer.guidance')}</h2>
		<span class="optional-badge">{t('render.optional')}</span>
	</div>

	<textarea
		value={request.styleTransferPrompt}
		oninput={(event) => request.setStyleTransferPrompt(event.currentTarget.value)}
		rows="4"
		aria-label={t('styleTransfer.guidance')}
		disabled={applying}
		placeholder={t('view.chat.placeholder')}></textarea>
</section>

<section class="step-card generate-section">
	<div class="step-header">
		<span class="step-num" aria-hidden="true">③</span>
		<h2>{t('styleTransfer.controls')}</h2>
	</div>

	<label class="format-label">
		<span class="format-text">{t('render.outputFormat')}</span>
		<select
			value={request.outputFormat}
			onchange={(event) => request.setOutputFormat(event.currentTarget.value as OutputFormat)}
			class="format-select"
		>
			<option value="webp">WebP</option>
			<option value="jpg">JPG</option>
			<option value="png">PNG</option>
			<option value="avif">AVIF</option>
		</select>
	</label>

	<label class="strength-label">
		<span class="strength-top">
			<span>{t('styleTransfer.strength')}</span>
			<span class="strength-value">{strengthPercent}%</span>
		</span>
		<input
			type="range"
			min="0"
			max="1"
			step="0.05"
			value={request.styleTransferStrength}
			aria-valuetext={strengthValueText}
			oninput={(event) => request.setStyleTransferStrength(inputNumber(event))}
		/>
		<span class="strength-scale" aria-hidden="true">
			<span>{t('styleTransfer.strengthLoose')}</span>
			<span>{t('styleTransfer.strengthStrict')}</span>
		</span>
	</label>

	<details class="advanced">
		<summary>{t('styleTransfer.advanced')}</summary>
		<label class="field">
			<span>{t('styleTransfer.negativePrompt')}</span>
			<textarea
				rows="3"
				value={request.styleNegativePrompt}
				placeholder={t('styleTransfer.negativePromptPlaceholder')}
				oninput={(event) => request.setStyleNegativePrompt(textareaValue(event))}></textarea>
		</label>
	</details>

	{#if !isAuthenticated}
		<p class="auth-hint">{t('styleTransfer.signInToApply')}</p>
	{/if}

	<button
		type="button"
		class="generate-btn"
		disabled={!canApply || !isAuthenticated}
		onclick={() => void submit()}
	>
		{#if request.status === 'rendering' && applying}
			<span class="spinner" aria-hidden="true"></span>
			{t('styleTransfer.applying')}
		{:else}
			{t('styleTransfer.apply')}
		{/if}
	</button>

	{#if error}
		<p class="submit-error" role="alert">{error}</p>
	{/if}
</section>

<style>
	.strength-top,
	.strength-scale {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.optional-badge {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-muted);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		padding: 0.15rem 0.5rem;
		border-radius: 100px;
	}

	.image-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.image-column {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.source-tabs {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 10px;
	}

	.source-tabs button {
		padding: 0.375rem 0.625rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}

	.source-tabs button.active {
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.source-preview {
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-background);
	}

	.source-preview img {
		width: 100%;
		max-height: 280px;
		object-fit: cover;
		display: block;
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

	.scene-type-toggle button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
	}

	.reference-tabs {
		display: flex;
		width: 100%;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 10px;
	}

	.reference-tabs button {
		flex: 1;
		padding: 0.375rem 0.625rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		text-align: center;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}

	.reference-tabs button.active {
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.presets-hint,
	.presets-empty {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.preset-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.625rem;
		max-height: 22rem;
		padding-right: 0.25rem;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.preset {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.375rem;
		font: inherit;
		font-size: 0.6875rem;
		font-weight: 500;
		text-align: center;
		color: var(--color-text);
		background: var(--color-background);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.preset:hover {
		border-color: var(--color-accent);
	}

	.preset.selected {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 8%, white);
	}

	.preset img {
		width: 100%;
		aspect-ratio: 1 / 1;
		object-fit: cover;
		border-radius: calc(var(--radius) - 4px);
		display: block;
	}

	.preset span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.strength-label,
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.strength-top,
	.field span {
		color: var(--color-muted);
	}

	.strength-top {
		justify-content: space-between;
	}

	.strength-value {
		color: var(--color-text);
		font-weight: 600;
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--color-accent);
	}

	.strength-scale {
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.advanced {
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}

	.advanced summary {
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.875rem;
		font-weight: 600;
	}

	.field {
		margin-top: 0.75rem;
	}

	textarea {
		width: 100%;
		font: inherit;
		font-size: 0.9375rem;
		line-height: 1.6;
		resize: vertical;
		padding: 0.75rem 1rem;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		transition: border-color 0.15s;
	}

	textarea:focus {
		outline: none;
		border-color: var(--color-border-focus);
	}

	textarea:disabled {
		opacity: 0.75;
		cursor: not-allowed;
	}

	@media (max-width: 760px) {
		.image-grid {
			grid-template-columns: 1fr;
		}

		.source-tabs {
			width: 100%;
		}

		.source-tabs button {
			flex: 1;
		}
	}

	@media (max-width: 480px) {
		.preset-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
