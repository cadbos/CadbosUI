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
	import { ADD_OBJECT_PRESETS } from '$lib/add-object-presets';
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';
	import { createTabController } from '$lib/utils';

	interface Props {
		disabled: boolean;
		applying: boolean;
		onApply: (prompt: string) => void;
	}
	let { disabled, applying, onApply }: Props = $props();

	let presetButtons = $state<HTMLElement[]>([]);
	const selected = $derived(
		ADD_OBJECT_PRESETS.find((preset) => preset.id === request.addObjectPresetId)
	);
	const activePresetIndex = $derived(
		Math.max(
			ADD_OBJECT_PRESETS.findIndex((preset) => preset.id === request.addObjectPresetId),
			0
		)
	);

	const presetRadios = createTabController({
		itemCount: () => ADD_OBJECT_PRESETS.length,
		getActiveIndex: () => activePresetIndex,
		setActiveIndex: (index) => {
			request.setAddObjectPresetId(ADD_OBJECT_PRESETS[index].id);
		},
		focusTab: (index) => presetButtons[index]?.focus()
	});

	function submit(): void {
		if (!selected) return;
		onApply(t(selected.prompt));
	}
</script>

<div class="tool">
	<p class="hint" id="add-object-select-hint">{t('edit.addObject.selectHint')}</p>

	<div class="grid" role="radiogroup" aria-labelledby="add-object-select-hint">
		{#each ADD_OBJECT_PRESETS as preset, index (preset.id)}
			{@const Icon = preset.Icon}
			<button
				{@attach (node) => {
					presetButtons[index] = node as HTMLElement;
				}}
				type="button"
				role="radio"
				class="preset"
				class:selected={request.addObjectPresetId === preset.id}
				aria-checked={request.addObjectPresetId === preset.id}
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
		{applying ? t('edit.addObject.applying') : t('edit.addObject.apply')}
	</button>
</div>

<style>
	.tool {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
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
		min-width: 0;
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

	.preset span {
		width: 100%;
		overflow-wrap: break-word;
	}

	.preset:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.preset.selected {
		color: var(--color-accent-text);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
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
