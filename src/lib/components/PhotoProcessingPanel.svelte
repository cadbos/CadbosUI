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
	import { Aperture, Image, RotateCcw } from '@lucide/svelte';

	import LazyImage from '$lib/components/LazyImage.svelte';
	import GenerateButton from '$lib/components/GenerateButton.svelte';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import {
		PHOTO_ADJUSTMENT_GROUPS,
		PHOTO_PRESETS,
		type PhotoAdjustmentKey,
		type PhotoAdjustments
	} from '$lib/photo-adjustments';
	import { photoProcessing } from '$lib/state/photo-processing.svelte';
	import { request, type OutputFormat } from '$lib/state/request.svelte';
	import { createTabController } from '$lib/utils';

	let { active }: { active: boolean } = $props();

	const uid = $props.id();
	let group = $state<(typeof PHOTO_ADJUSTMENT_GROUPS)[number]['id']>('light');
	const groupButtons: (HTMLButtonElement | undefined)[] = [];
	const sourceUrl = $derived(photoProcessing.sourceUrl);
	const controlsDisabled = $derived(!sourceUrl || photoProcessing.busy);
	const selectedPreset = $derived(
		PHOTO_PRESETS.find((preset) =>
			Object.entries(preset.adjustments).every(
				([key, value]) => request.photoAdjustments[key as PhotoAdjustmentKey] === value
			)
		)?.id
	);
	const hasAdjustments = $derived(
		Object.values(request.photoAdjustments).some((value) => value !== 0)
	);
	const groupTabs = createTabController({
		itemCount: () => PHOTO_ADJUSTMENT_GROUPS.length,
		getActiveIndex: () => PHOTO_ADJUSTMENT_GROUPS.findIndex((item) => item.id === group),
		setActiveIndex: (index) => {
			group = PHOTO_ADJUSTMENT_GROUPS[index].id;
		},
		focusTab: (index) => groupButtons[index]?.focus()
	});

	$effect(() => {
		const source = sourceUrl;
		if (!active || !source) return;
		photoProcessing.preparePresets(source);
		return () => photoProcessing.clearPresets();
	});

	function adjustmentLabel(key: PhotoAdjustmentKey): string {
		return t(`photoProcessing.adjustment.${key}` as TranslationKey);
	}

	function minimum(key: PhotoAdjustmentKey): number {
		return key === 'bloom' || key === 'grain' ? 0 : -100;
	}

	function updateAdjustment(key: PhotoAdjustmentKey, event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		const value = event.currentTarget.valueAsNumber;
		if (!Number.isFinite(value)) return;
		request.setPhotoAdjustment(key, Math.round(Math.min(100, Math.max(minimum(key), value))));
	}

	function applyPreset(adjustments: PhotoAdjustments): void {
		request.setPhotoAdjustments(adjustments);
	}
</script>

<section class="photo-panel" aria-label={t('mode.photoProcessing')}>
	<div class="panel-intro">
		<p class="panel-description">{t('photoProcessing.description')}</p>
		<button
			type="button"
			class="reset-all icon-button"
			aria-label={t('photoProcessing.reset')}
			title={t('photoProcessing.reset')}
			disabled={controlsDisabled || !hasAdjustments}
			onclick={() => request.resetPhotoAdjustments()}
		>
			<RotateCcw size={16} aria-hidden="true" />
		</button>
	</div>

	<div class="presets-section">
		<h2>{t('photoProcessing.presets')}</h2>
		<div class="presets">
			{#each PHOTO_PRESETS as preset (preset.id)}
				<button
					type="button"
					class={['preset', { selected: selectedPreset === preset.id }]}
					aria-pressed={selectedPreset === preset.id}
					disabled={controlsDisabled}
					onclick={() => applyPreset(preset.adjustments)}
				>
					<span class="preset-preview">
						{#if sourceUrl}
							<LazyImage
								src={photoProcessing.presetPreviewUrls[preset.id] ?? sourceUrl}
								alt=""
								decorative
								loading="eager"
							/>
						{:else}
							<Image size={22} aria-hidden="true" />
						{/if}
						{#if selectedPreset === preset.id}
							<span class="preset-selected"><Aperture size={11} aria-hidden="true" /></span>
						{/if}
					</span>
					<span class="preset-name"
						>{t(`photoProcessing.preset.${preset.id}` as TranslationKey)}</span
					>
				</button>
			{/each}
		</div>
	</div>

	<div class="group-tabs" role="tablist" aria-label={t('mode.photoProcessing')}>
		{#each PHOTO_ADJUSTMENT_GROUPS as item, index (item.id)}
			<button
				{@attach (node) => {
					groupButtons[index] = node;
					return () => {
						groupButtons[index] = undefined;
					};
				}}
				type="button"
				role="tab"
				id={`${uid}-tab-${item.id}`}
				aria-controls={`${uid}-group-${item.id}`}
				aria-selected={group === item.id}
				tabindex={group === item.id ? 0 : -1}
				class={{ active: group === item.id }}
				onclick={() => groupTabs.activate(index)}
				onkeydown={groupTabs.onKeydown}
			>
				{t(`photoProcessing.group.${item.id}` as TranslationKey)}
			</button>
		{/each}
	</div>

	{#each PHOTO_ADJUSTMENT_GROUPS as item (item.id)}
		<div
			class="adjustments"
			role="tabpanel"
			id={`${uid}-group-${item.id}`}
			aria-labelledby={`${uid}-tab-${item.id}`}
			hidden={group !== item.id}
			tabindex="0"
		>
			{#each item.keys as key (key)}
				<div class={['adjustment', { changed: request.photoAdjustments[key] !== 0 }]}>
					<label for={`${uid}-${key}`}>{adjustmentLabel(key)}</label>
					<div class="adjustment-controls">
						<input
							id={`${uid}-${key}`}
							class={['slider', { temperature: key === 'temperature', tint: key === 'tint' }]}
							type="range"
							min={minimum(key)}
							max="100"
							step="1"
							value={request.photoAdjustments[key]}
							disabled={controlsDisabled}
							oninput={(event) => updateAdjustment(key, event)}
						/>
						<input
							class="value-input"
							type="number"
							aria-label={adjustmentLabel(key)}
							min={minimum(key)}
							max="100"
							step="1"
							value={request.photoAdjustments[key]}
							disabled={controlsDisabled}
							oninput={(event) => updateAdjustment(key, event)}
						/>
						<button
							type="button"
							class="icon-button reset-adjustment"
							aria-label={ti('photoProcessing.resetAdjustment', { name: adjustmentLabel(key) })}
							title={ti('photoProcessing.resetAdjustment', { name: adjustmentLabel(key) })}
							disabled={controlsDisabled || request.photoAdjustments[key] === 0}
							onclick={() => request.setPhotoAdjustment(key, 0)}
						>
							<RotateCcw size={14} aria-hidden="true" />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/each}

	<div class="action-bar">
		<label class="format-label">
			<span>{t('render.outputFormat')}</span>
			<select
				value={request.outputFormat}
				disabled={photoProcessing.busy}
				onchange={(event) => request.setOutputFormat(event.currentTarget.value as OutputFormat)}
			>
				<option value="webp">WebP</option>
				<option value="jpg">JPG</option>
				<option value="png">PNG</option>
				<option value="avif">AVIF</option>
			</select>
		</label>
		<label class="upscale-option">
			<input
				type="checkbox"
				bind:checked={photoProcessing.upscaleOnSave}
				disabled={controlsDisabled}
			/>
			<span>{t('toolbar.upscale')}</span>
		</label>
		<div class="save-trigger">
			<GenerateButton
				label={photoProcessing.busy
					? t(photoProcessing.upscaling ? 'generationOverlay.upscale' : 'photoProcessing.saving')
					: t(
							photoProcessing.upscaleOnSave
								? 'photoProcessing.saveAndUpscale'
								: 'photoProcessing.save'
						)}
				disabled={photoProcessing.upscaleOnSave
					? !photoProcessing.canUpscale
					: !photoProcessing.canSave}
				busy={photoProcessing.busy}
				onclick={() =>
					void (photoProcessing.upscaleOnSave
						? photoProcessing.upscale(true)
						: photoProcessing.save())}
			/>
		</div>
	</div>

	{#if photoProcessing.error}
		<p class="error" role="alert">{photoProcessing.error}</p>
	{/if}
	{#if photoProcessing.notice}
		<p class="notice" role="status">{photoProcessing.notice}</p>
	{/if}
	{#if photoProcessing.completedResultUrl}
		<a class="result-download" href={photoProcessing.completedResultUrl} download>
			{t('photoProcessing.downloadResult')}
		</a>
	{/if}
</section>

<style>
	.photo-panel {
		display: flex;
		flex-direction: column;
		gap: 1.125rem;
		color: var(--color-text);
		container-type: inline-size;
	}

	.panel-intro {
		display: flex;
		align-items: start;
		gap: 0.5rem;
	}

	.panel-description {
		margin: 0;
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	h2 {
		margin: 0 0 0.625rem;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted-strong);
		cursor: pointer;
	}

	.icon-button:hover:not(:disabled) {
		background: var(--color-surface-hover);
		color: var(--color-accent-text);
	}

	.presets {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem 0.5rem;
	}

	.preset {
		min-width: 0;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted-strong);
		font: inherit;
		cursor: pointer;
	}

	.preset-preview {
		--image-fit: cover;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		overflow: hidden;
		border: 2px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-background);
		transition: border-color 0.15s;
	}

	.preset:hover:not(:disabled) .preset-preview,
	.preset.selected .preset-preview {
		border-color: var(--color-accent);
	}

	.preset.selected .preset-name {
		color: var(--color-accent-text);
	}

	.preset-selected {
		position: absolute;
		inset: auto 4px 4px auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 999px;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
	}

	.preset-name {
		display: block;
		margin-top: 0.375rem;
		font-size: 0.6875rem;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.group-tabs {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: var(--radius);
		background: var(--color-background);
	}

	.group-tabs button {
		min-width: 0;
		min-height: 2.25rem;
		padding: 0.375rem 0.25rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted-strong);
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}

	.group-tabs button.active {
		border-color: var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-sm);
	}

	.adjustments {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.adjustments[hidden] {
		display: none;
	}

	.adjustment {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: 0.625rem;
		align-items: center;
	}

	.adjustment label {
		font-size: 0.75rem;
		line-height: 1.25;
		color: var(--color-muted-strong);
	}

	.adjustment.changed label {
		color: var(--color-text);
	}

	.adjustment-controls {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	.slider {
		flex: 1;
		width: 100%;
		min-width: 2rem;
		height: 1.5rem;
		margin: 0;
		accent-color: var(--color-accent);
		cursor: pointer;
	}

	.slider.temperature,
	.slider.tint {
		appearance: none;
		height: 1.5rem;
		border-radius: 999px;
		background: linear-gradient(to right, #5f9bcc, #dae0dc, #d79948) center / 100% 0.375rem
			no-repeat;
	}

	.slider.tint {
		background: linear-gradient(to right, #549b59, #dae0dc, #b76cb6) center / 100% 0.375rem
			no-repeat;
	}

	.slider.temperature::-webkit-slider-thumb,
	.slider.tint::-webkit-slider-thumb {
		appearance: none;
		width: 1rem;
		height: 1rem;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.slider.temperature::-moz-range-thumb,
	.slider.tint::-moz-range-thumb {
		width: 1rem;
		height: 1rem;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.value-input {
		box-sizing: border-box;
		width: 3rem;
		height: 2rem;
		padding: 0.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
		appearance: textfield;
	}

	.value-input::-webkit-inner-spin-button,
	.value-input::-webkit-outer-spin-button {
		appearance: none;
		margin: 0;
	}

	.reset-adjustment {
		width: 1.75rem;
		height: 2rem;
	}

	.action-bar {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}
	.format-label {
		display: flex;
		flex: 0 1 7rem;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		min-width: 4rem;
		color: var(--color-muted-strong);
		font-size: 0.75rem;
	}
	.format-label select {
		width: 100%;
		max-width: 7rem;
		height: 2.5rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
	}
	.upscale-option {
		display: flex;
		align-items: center;
		align-self: flex-end;
		flex: 1 1 6rem;
		gap: 0.375rem;
		min-width: 0;
		min-height: 2.5rem;
		color: var(--color-text);
		font-size: 0.75rem;
		line-height: 1.35;
		cursor: pointer;
	}
	.upscale-option input {
		flex: 0 0 auto;
		width: 1rem;
		height: 1rem;
		margin: 0;
		accent-color: var(--color-accent);
	}
	.upscale-option span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.save-trigger {
		flex: 0 0 3.5rem;
	}

	button:disabled,
	input:disabled,
	select:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	button:focus-visible,
	input:focus-visible,
	select:focus-visible,
	.adjustments:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 3px;
	}

	.error,
	.notice {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.45;
	}

	.error {
		color: var(--color-danger);
	}

	.notice {
		color: var(--color-muted-strong);
	}

	.result-download {
		align-self: start;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		color: var(--color-accent-text);
		font-size: 0.8125rem;
		text-decoration: none;
	}

	.result-download:hover {
		background: var(--color-surface-hover);
	}

	.result-download:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 3px;
	}

	@container (max-width: 300px) {
		.adjustment {
			grid-template-columns: 1fr;
			gap: 0.375rem;
		}
	}
</style>
