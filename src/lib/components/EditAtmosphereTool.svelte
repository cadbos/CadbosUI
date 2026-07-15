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
	import { Cloudy, Lamp, Moon, MoonStar, Sun, Sunrise } from '@lucide/svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { createTabController } from '$lib/utils';

	type Scene = 'interior' | 'exterior';
	type LucideIcon = typeof Lamp;

	interface Preset {
		id: string;
		label: TranslationKey;
		promptInterior: TranslationKey;
		promptExterior: TranslationKey;
		Icon: LucideIcon;
	}

	const SCENES: { id: Scene; label: TranslationKey }[] = [
		{ id: 'interior', label: 'edit.atmosphere.interior' },
		{ id: 'exterior', label: 'edit.atmosphere.exterior' }
	];

	const PRESETS: Preset[] = [
		{
			id: 'midday',
			label: 'edit.atmosphere.midday.label',
			promptInterior: 'edit.atmosphere.midday.promptInterior',
			promptExterior: 'edit.atmosphere.midday.promptExterior',
			Icon: Sun
		},
		{
			id: 'golden-hour',
			label: 'edit.atmosphere.goldenHour.label',
			promptInterior: 'edit.atmosphere.goldenHour.promptInterior',
			promptExterior: 'edit.atmosphere.goldenHour.promptExterior',
			Icon: Sunrise
		},
		{
			id: 'blue-hour',
			label: 'edit.atmosphere.blueHour.label',
			promptInterior: 'edit.atmosphere.blueHour.promptInterior',
			promptExterior: 'edit.atmosphere.blueHour.promptExterior',
			Icon: MoonStar
		},
		{
			id: 'overcast',
			label: 'edit.atmosphere.overcast.label',
			promptInterior: 'edit.atmosphere.overcast.promptInterior',
			promptExterior: 'edit.atmosphere.overcast.promptExterior',
			Icon: Cloudy
		},
		{
			id: 'warm-light',
			label: 'edit.atmosphere.warmLight.label',
			promptInterior: 'edit.atmosphere.warmLight.promptInterior',
			promptExterior: 'edit.atmosphere.warmLight.promptExterior',
			Icon: Lamp
		},
		{
			id: 'dim',
			label: 'edit.atmosphere.dim.label',
			promptInterior: 'edit.atmosphere.dim.promptInterior',
			promptExterior: 'edit.atmosphere.dim.promptExterior',
			Icon: Moon
		}
	];

	interface Props {
		disabled: boolean;
		applying: boolean;
		onApply: (prompt: string) => void;
	}
	let { disabled, applying, onApply }: Props = $props();

	let scene = $state<Scene>('interior');
	let sceneTabButtons = $state<HTMLElement[]>([]);
	let selectedId = $state<string | null>(null);
	let presetButtons = $state<HTMLElement[]>([]);
	const selected = $derived(PRESETS.find((preset) => preset.id === selectedId));
	const activePresetIndex = $derived(
		Math.max(
			PRESETS.findIndex((preset) => preset.id === selectedId),
			0
		)
	);

	const sceneTabs = createTabController({
		itemCount: () => SCENES.length,
		getActiveIndex: () => SCENES.findIndex((s) => s.id === scene),
		setActiveIndex: (index) => {
			scene = SCENES[index].id;
		},
		focusTab: (index) => sceneTabButtons[index]?.focus()
	});

	const presetRadios = createTabController({
		itemCount: () => PRESETS.length,
		getActiveIndex: () => activePresetIndex,
		setActiveIndex: (index) => {
			selectedId = PRESETS[index].id;
		},
		focusTab: (index) => presetButtons[index]?.focus()
	});

	function submit(): void {
		if (!selected) return;
		onApply(t(scene === 'interior' ? selected.promptInterior : selected.promptExterior));
	}
</script>

<div class="tool">
	<div class="scene-toggle" role="tablist" aria-label={t('edit.atmosphere.sceneLabel')}>
		{#each SCENES as sceneOption, index (sceneOption.id)}
			<button
				bind:this={sceneTabButtons[index]}
				type="button"
				role="tab"
				aria-selected={scene === sceneOption.id}
				tabindex={scene === sceneOption.id ? 0 : -1}
				class:active={scene === sceneOption.id}
				{disabled}
				onclick={() => sceneTabs.activate(index)}
				onkeydown={sceneTabs.onKeydown}
			>
				{t(sceneOption.label)}
			</button>
		{/each}
	</div>

	<p class="hint" id="atmosphere-select-hint">{t('edit.atmosphere.selectHint')}</p>

	<div class="grid" role="radiogroup" aria-labelledby="atmosphere-select-hint">
		{#each PRESETS as preset, index (preset.id)}
			{@const Icon = preset.Icon}
			<button
				bind:this={presetButtons[index]}
				type="button"
				role="radio"
				class="preset"
				class:selected={selectedId === preset.id}
				aria-checked={selectedId === preset.id}
				tabindex={index === activePresetIndex ? 0 : -1}
				{disabled}
				onclick={() => presetRadios.activate(index)}
				onkeydown={presetRadios.onKeydown}
			>
				<Icon size={20} strokeWidth={1.6} aria-hidden="true" />
				<span>{t(preset.label)}</span>
			</button>
		{/each}
	</div>

	<button type="button" class="btn-apply" disabled={disabled || !selected} onclick={submit}>
		{#if applying}
			<span class="spinner" aria-hidden="true"></span>
		{/if}
		{applying ? t('edit.atmosphere.applying') : t('edit.atmosphere.apply')}
	</button>
</div>

<style>
	.tool {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.scene-toggle {
		display: flex;
		gap: 0.375rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 10px;
		width: 100%;
	}

	.scene-toggle button {
		flex: 1;
		padding: 0.4rem 0.875rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.scene-toggle button:hover:not(.active, :disabled) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.scene-toggle button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
	}

	.scene-toggle button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.625rem;
	}

	.preset {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 0.75rem 0.5rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		text-align: center;
		color: var(--color-text);
		background: var(--color-background);
		border: 1.5px solid var(--color-border);
		border-radius: 12px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s,
			color 0.15s;
	}

	.preset:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.preset.selected {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 8%, white);
		border-color: var(--color-accent);
	}

	.preset:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-apply {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		align-self: flex-start;
		padding: 0.6rem 1.25rem;
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: none;
		border-radius: 10px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-apply:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.btn-apply:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.spinner {
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid rgb(255 255 255 / 0.35);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 480px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
