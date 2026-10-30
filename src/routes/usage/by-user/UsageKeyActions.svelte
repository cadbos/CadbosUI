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
	import { ArrowUpRight, Check, Copy } from '@lucide/svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { logBoundaryError } from '$lib/utils';

	interface Props {
		npub: string;
		pubkeyViewer: string;
	}

	let { npub, pubkeyViewer }: Props = $props();

	let copied = $state(false);
	let copyFailed = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

	function clearCopyReset(): () => void {
		return () => clearTimeout(copyResetTimer);
	}

	$effect(clearCopyReset);

	async function copyNpub(): Promise<void> {
		copyFailed = false;
		try {
			await navigator.clipboard.writeText(npub);
			copied = true;
			clearTimeout(copyResetTimer);
			copyResetTimer = setTimeout(() => (copied = false), 2000);
		} catch (error) {
			copied = false;
			copyFailed = true;
			logBoundaryError('usageKey.copyNpub', error);
		}
	}

	const copyLabel = $derived(
		copyFailed
			? t('auth.profile.npubCopyFailed')
			: copied
				? t('auth.profile.npubCopied')
				: t('auth.profile.npubCopy')
	);
</script>

<span class="key-actions">
	<a
		class="key-action"
		href={pubkeyViewer.replaceAll('{}', npub)}
		target="_blank"
		rel="external noopener noreferrer"
		title={t('auth.profile.viewOnPrimal')}
	>
		<ArrowUpRight size={18} strokeWidth={1.8} aria-hidden="true" />
		<span class="visually-hidden">{t('auth.profile.viewOnPrimal')}</span>
	</a>
	<button
		type="button"
		class={['key-action', { 'key-action-error': copyFailed }]}
		title={copyLabel}
		onclick={copyNpub}
	>
		{#if copied}
			<Check size={18} strokeWidth={2} aria-hidden="true" />
		{:else}
			<Copy size={18} strokeWidth={1.8} aria-hidden="true" />
		{/if}
		<span class="visually-hidden" aria-live="polite">{copyLabel}</span>
	</button>
</span>

<style>
	.key-actions {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.25rem;
	}

	.key-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		color: var(--color-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.key-action:hover,
	.key-action:focus-visible {
		color: var(--color-accent);
		background: var(--color-background);
		border-color: var(--color-border);
	}

	.key-action-error {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}
</style>
