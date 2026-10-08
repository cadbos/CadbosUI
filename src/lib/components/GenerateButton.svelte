<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate
written agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<script lang="ts">
	import { Play } from '@lucide/svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';

	interface Props {
		label: string;
		disabled?: boolean;
		busy?: boolean;
		onclick: () => void;
	}

	let { label, disabled = false, busy = false, onclick }: Props = $props();

	const signedIn = $derived(auth.status === 'authenticated');
</script>

<div class="run-row">
	{#if !signedIn}
		<p class="sign-in">{t('generation.signInToStart')}</p>
	{/if}
	<button
		type="button"
		class="run"
		aria-label={label}
		title={t('generation.startHint')}
		aria-busy={busy}
		disabled={disabled || busy}
		{onclick}
	>
		{#if busy}
			<span class="spinner" aria-hidden="true"></span>
		{:else}
			<Play class="glyph" size={24} fill="currentColor" strokeWidth={0} aria-hidden="true" />
		{/if}
	</button>
</div>

<style>
	.run-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
	}

	.sign-in {
		margin: 0;
		flex: 1 1 auto;
		min-width: 0;
		font-size: 0.875rem;
		line-height: 1.35;
		text-align: start;
		color: var(--color-muted-strong);
	}

	.run {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: flex-end;
		flex: 0 0 auto;
		width: 3.5rem;
		height: 3.5rem;
		margin-left: auto;
		padding: 0;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: none;
		border-radius: 50%;
		cursor: pointer;
		box-shadow:
			0 3px 5px -1px rgb(0 0 0 / 0.2),
			0 6px 10px 0 rgb(0 0 0 / 0.14),
			0 1px 18px 0 rgb(47 111 79 / 0.28);
		transition:
			background 0.15s,
			box-shadow 0.15s,
			transform 0.1s;
	}

	.run:hover:not(:disabled) {
		background: var(--color-accent-hover);
		box-shadow:
			0 5px 5px -3px rgb(0 0 0 / 0.2),
			0 8px 10px 1px rgb(0 0 0 / 0.14),
			0 3px 14px 2px rgb(47 111 79 / 0.32);
		transform: translateY(-1px);
	}

	.run:active:not(:disabled) {
		box-shadow:
			0 7px 8px -4px rgb(0 0 0 / 0.2),
			0 12px 17px 2px rgb(0 0 0 / 0.14),
			0 5px 22px 4px rgb(47 111 79 / 0.3);
		transform: translateY(0);
	}

	.run:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		box-shadow: none;
		transform: none;
	}

	.run :global(.glyph) {
		display: block;
		margin-left: 2px;
	}

	.spinner {
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid rgb(255 255 255 / 0.35);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
