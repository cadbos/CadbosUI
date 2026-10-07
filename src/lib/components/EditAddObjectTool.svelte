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
	import GenerateButton from '$lib/components/GenerateButton.svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { request } from '$lib/state/request.svelte';

	interface Props {
		disabled: boolean;
		applying: boolean;
		onApply: (prompt: string) => void;
	}
	let { disabled, applying, onApply }: Props = $props();

	const promptText = $derived(request.addObjectInstruction.trim());
	const finalPrompt = $derived(
		promptText === '' ? '' : ti('edit.addObject.userPromptTemplate', { object: promptText })
	);

	function submit(): void {
		if (finalPrompt === '') return;
		onApply(finalPrompt);
	}
</script>

<div class="tool">
	<p class="hint" id="add-object-select-hint">{t('edit.addObject.selectHint')}</p>

	<div class="grid" role="group" aria-labelledby="add-object-select-hint">
		{#each ADD_OBJECT_PRESETS as preset (preset.id)}
			{@const Icon = preset.Icon}
			<button
				type="button"
				class="preset"
				{disabled}
				title={t(preset.label)}
				onclick={() => request.setAddObjectInstruction(t(preset.phrase))}
			>
				<Icon size={20} strokeWidth={1.6} aria-hidden="true" />
				<span class="tile-label">{t(preset.label)}</span>
			</button>
		{/each}
	</div>

	<label class="field">
		<span class="field-label">{t('edit.addObject.customLabel')}</span>
		<textarea
			value={request.addObjectInstruction}
			oninput={(event) => request.setAddObjectInstruction(event.currentTarget.value)}
			rows="2"
			maxlength="500"
			{disabled}
			placeholder={t('edit.addObject.customPlaceholder')}></textarea>
	</label>

	{#if promptText !== ''}
		<p class="preview">
			<span class="preview-label">{t('edit.addObject.previewLabel')}</span>
			{promptText}
		</p>
	{/if}

	{#if auth.status !== 'authenticated'}
		<p class="auth-hint">{t('edit.signInToApply')}</p>
	{/if}

	<GenerateButton
		label={t('edit.addObject.apply')}
		disabled={disabled || finalPrompt === '' || auth.status !== 'authenticated'}
		busy={applying}
		onclick={submit}
	/>
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
		position: relative;
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

	.preset span,
	.tile-label {
		width: 100%;
		overflow-wrap: break-word;
	}

	@container tools-panel (max-width: 520px) {
		.tile-label {
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
	}

	.preset:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.preset:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.field-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-muted);
	}

	textarea {
		font: inherit;
		font-size: 0.9375rem;
		resize: vertical;
		padding: 0.625rem 0.875rem;
		border: 1.5px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		transition: border-color 0.15s;
		min-height: 3.5rem;
	}

	textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	textarea::placeholder {
		color: var(--color-muted);
		opacity: 0.6;
	}

	textarea:disabled {
		opacity: 0.6;
	}

	.preview {
		margin: 0;
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted-strong);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: 10px;
	}

	.preview-label {
		display: block;
		margin-bottom: 0.25rem;
		font-weight: 600;
		color: var(--color-muted);
	}

	.auth-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	@media (max-width: 480px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
