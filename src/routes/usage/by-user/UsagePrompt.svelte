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
	import { Check, Copy, MessageSquareText } from '@lucide/svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { logBoundaryError } from '$lib/utils';

	interface Props {
		id: string;
		prompt: string;
	}

	let { id, prompt }: Props = $props();

	const POPOVER_MAX_WIDTH_REM = 28;
	const VIEWPORT_GUTTER = 16;
	const GAP = 8;

	let truncated = $state(false);
	let copied = $state(false);
	let copyFailed = $state(false);
	let trigger: HTMLButtonElement | null = null;
	let placement = $state({ top: 0, left: 0, arrowLeft: 0 });
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
	const popoverId = $derived(`usage-prompt-${id}`);

	function watchTruncation(node: HTMLElement): () => void {
		const update = (): void => {
			truncated = node.scrollWidth > node.clientWidth;
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		update();
		return () => observer.disconnect();
	}

	function registerTrigger(node: HTMLButtonElement): () => void {
		trigger = node;
		return () => {
			trigger = null;
		};
	}

	function clearCopyReset(): () => void {
		return () => clearTimeout(copyResetTimer);
	}

	$effect(clearCopyReset);

	// The popover lives in the top layer, outside the scrolling table, so it is
	// placed against the trigger in document coordinates just before it opens.
	function place(event: ToggleEvent): void {
		if (event.newState !== 'open' || !trigger) return;
		const rect = trigger.getBoundingClientRect();
		const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
		const width = Math.min(
			POPOVER_MAX_WIDTH_REM * rem,
			document.documentElement.clientWidth - 2 * VIEWPORT_GUTTER
		);
		const left = Math.max(VIEWPORT_GUTTER, rect.right - width);
		placement = {
			top: rect.bottom + window.scrollY + GAP,
			left: left + window.scrollX,
			arrowLeft: rect.left + rect.width / 2 - left
		};
	}

	async function copyPrompt(): Promise<void> {
		copyFailed = false;
		try {
			await navigator.clipboard.writeText(prompt);
			copied = true;
			clearTimeout(copyResetTimer);
			copyResetTimer = setTimeout(() => (copied = false), 2000);
		} catch (error) {
			copied = false;
			copyFailed = true;
			logBoundaryError('usagePrompt.copy', error);
		}
	}
</script>

<div class="prompt-cell">
	<span class="prompt-text" {@attach watchTruncation}>{prompt}</span>
	{#if truncated}
		<button
			{@attach registerTrigger}
			type="button"
			class="prompt-toggle"
			popovertarget={popoverId}
			aria-label={ti('usage.generations.promptShow', { id })}
			title={ti('usage.generations.promptShow', { id })}
		>
			<MessageSquareText size={16} strokeWidth={1.8} aria-hidden="true" />
		</button>
		<div
			id={popoverId}
			popover="auto"
			class="prompt-popover"
			style:top="{placement.top}px"
			style:left="{placement.left}px"
			style:--arrow-left="{placement.arrowLeft}px"
			onbeforetoggle={place}
		>
			<p class="prompt-full">{prompt}</p>
			<button type="button" class="copy-button" onclick={copyPrompt}>
				{#if copied}
					<Check size={16} strokeWidth={1.8} aria-hidden="true" />
					{t('usage.generations.promptCopied')}
				{:else}
					<Copy size={16} strokeWidth={1.8} aria-hidden="true" />
					{t('usage.generations.promptCopy')}
				{/if}
			</button>
			{#if copyFailed}
				<p class="copy-error" role="alert">{t('usage.generations.promptCopyFailed')}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.prompt-cell {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		min-height: 1.75rem;
	}

	.prompt-text {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.prompt-toggle {
		display: inline-grid;
		place-items: center;
		flex: 0 0 auto;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-muted);
		cursor: pointer;
	}

	.prompt-toggle:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.prompt-popover {
		position: absolute;
		inset: auto;
		box-sizing: border-box;
		width: min(28rem, calc(100vw - 2rem));
		margin: 0;
		padding: 0.875rem 1rem;
		overflow: visible;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	.prompt-popover::before {
		content: '';
		position: absolute;
		top: -0.375rem;
		left: calc(var(--arrow-left) - 0.375rem);
		width: 0.75rem;
		height: 0.75rem;
		border-top: 1px solid var(--color-border);
		border-left: 1px solid var(--color-border);
		background: var(--color-surface);
		transform: rotate(45deg);
	}

	.prompt-full {
		max-height: 16rem;
		margin: 0 0 0.75rem;
		overflow-y: auto;
		font-size: 0.875rem;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.copy-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.copy-button:hover {
		background: var(--color-surface-hover);
	}

	.copy-error {
		margin: 0.5rem 0 0;
		color: var(--color-danger);
		font-size: 0.8125rem;
	}
</style>
