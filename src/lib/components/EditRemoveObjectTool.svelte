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
	import GenerateButton from '$lib/components/GenerateButton.svelte';
	import ModeHint from '$lib/components/ModeHint.svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { request } from '$lib/state/request.svelte';

	interface Props {
		disabled: boolean;
		applying: boolean;
		onApply: (prompt: string) => void;
	}
	let { disabled, applying, onApply }: Props = $props();

	function submit(): void {
		const trimmed = request.removeObjectText.trim();
		if (!trimmed) return;
		onApply(ti('edit.removeObject.promptTemplate', { object: trimmed }));
	}
</script>

<div class="tool">
	<label class="field">
		<span class="field-label">{t('edit.removeObject.label')}</span>
		<input
			type="text"
			value={request.removeObjectText}
			oninput={(event) => request.setRemoveObjectText(event.currentTarget.value)}
			{disabled}
			placeholder={t('edit.removeObject.placeholder')}
		/>
	</label>

	<p class="hint">{t('edit.removeObject.hint')}</p>

	<ModeHint field="removeObject" text={request.removeObjectText} />

	{#if auth.status !== 'authenticated'}
		<p class="auth-hint">{t('edit.signInToApply')}</p>
	{/if}

	<GenerateButton
		label={t('edit.removeObject.apply')}
		disabled={disabled || !request.removeObjectText.trim() || auth.status !== 'authenticated'}
		busy={applying}
		onclick={submit}
	/>
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

	.auth-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}
</style>
