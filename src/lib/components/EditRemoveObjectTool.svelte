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
	import { Eraser } from 'lucide-svelte';
	import { t, ti } from '$lib/i18n/index.svelte';

	interface Props {
		disabled: boolean;
		applying: boolean;
		onApply: (prompt: string) => void;
	}
	let { disabled, applying, onApply }: Props = $props();

	let objectText = $state('');

	function submit(): void {
		const trimmed = objectText.trim();
		if (!trimmed) return;
		onApply(ti('edit.removeObject.promptTemplate', { object: trimmed }));
	}
</script>

<div class="tool">
	<label class="field">
		<span class="field-label">{t('edit.removeObject.label')}</span>
		<input
			type="text"
			bind:value={objectText}
			{disabled}
			placeholder={t('edit.removeObject.placeholder')}
		/>
	</label>

	<p class="hint">{t('edit.removeObject.hint')}</p>

	<button
		type="button"
		class="btn-apply"
		disabled={disabled || !objectText.trim()}
		onclick={submit}
	>
		{#if applying}
			<span class="spinner" aria-hidden="true"></span>
		{:else}
			<Eraser size={16} strokeWidth={1.8} aria-hidden="true" />
		{/if}
		{applying ? t('edit.removeObject.applying') : t('edit.removeObject.apply')}
	</button>
</div>

<style>
	.tool {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
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

	input {
		font: inherit;
		font-size: 0.9375rem;
		padding: 0.625rem 0.875rem;
		border: 1.5px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		transition: border-color 0.15s;
	}

	input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	input::placeholder {
		color: var(--color-muted);
		opacity: 0.6;
	}

	input:disabled {
		opacity: 0.6;
	}

	.hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.btn-apply {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
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
</style>
