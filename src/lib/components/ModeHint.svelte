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
	import { ArrowRight, Lightbulb } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import { getLocale, t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import {
		modeHintFor,
		targetLabel,
		type EditIntent,
		type ModeHintField,
		type ModeHintFormatField,
		type ModeHintTarget
	} from '$lib/mode-hints';
	import { request } from '$lib/state/request.svelte';
	import { buildWorkspaceUrl } from '$lib/state/url-state';
	import { logBoundaryError } from '$lib/utils';

	interface Props {
		field: ModeHintField;
		text: string;
	}

	let { field, text }: Props = $props();

	const INTENT_MESSAGES: Record<EditIntent, TranslationKey> = {
		add: 'modeHint.intent.add',
		remove: 'modeHint.intent.remove',
		replace: 'modeHint.intent.replace',
		recolor: 'modeHint.intent.recolor',
		light: 'modeHint.intent.light',
		style: 'modeHint.intent.style'
	};

	const FORMAT_MESSAGES: Record<ModeHintFormatField, TranslationKey> = {
		removeObject: 'modeHint.format.removeObject',
		objectReplacement: 'modeHint.format.objectReplacement',
		textureReplacement: 'modeHint.format.textureReplacement'
	};

	const hint = $derived(modeHintFor(field, text));
	const locale = $derived(getLocale());

	function messageParts(
		key: TranslationKey,
		triggers: string[]
	): { value: string; word: boolean }[] {
		const [before, after] = t(key).split('{words}');
		const words = new Intl.ListFormat(locale, { type: 'conjunction' }).formatToParts(triggers);
		return [
			{ value: before, word: false },
			...words.map((part) => ({ value: part.value, word: part.type === 'element' })),
			{ value: after, word: false }
		];
	}

	function switchMode(target: ModeHintTarget): void {
		request.prefillFromModeHint(target, text);
		const url = buildWorkspaceUrl(
			target.mode,
			request,
			target.mode === 'edit' ? { tool: target.tool } : {}
		);
		goto(resolve(url as PathnameWithSearchOrHash, {}), { noScroll: true }).catch((error: unknown) =>
			logBoundaryError('modeHint.switchMode', error)
		);
	}
</script>

{#snippet message(key: TranslationKey, triggers: string[])}
	<p>
		{#each messageParts(key, triggers) as part, i (i)}
			{#if part.word}<q class="mode-hint-word">{part.value}</q>{:else}{part.value}{/if}
		{/each}
	</p>
{/snippet}

<div class="mode-hint-live" role="status" aria-live="polite" aria-atomic="true" lang={locale}>
	{#if hint}
		<div class="mode-hint-reveal">
			<div class="mode-hint">
				<span class="mode-hint-icon">
					<Lightbulb size={14} strokeWidth={2} aria-hidden="true" />
				</span>
				<div class="mode-hint-body">
					{#if hint.kind === 'switch'}
						{@const target = t(targetLabel(hint.target))}
						{@render message(INTENT_MESSAGES[hint.intent], hint.triggers)}
						<button type="button" class="mode-hint-switch" onclick={() => switchMode(hint.target)}>
							{ti('modeHint.switch', { target })}
							<ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
						</button>
					{:else}
						{@render message(FORMAT_MESSAGES[hint.field], hint.triggers)}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.mode-hint-live:empty {
		display: none;
	}

	.mode-hint-reveal {
		display: grid;
		grid-template-rows: 1fr;
		overflow: hidden;
		animation: mode-hint-reveal 0.2s ease-out 0.4s backwards;
	}

	.mode-hint {
		display: flex;
		min-height: 0;
		align-items: flex-start;
		gap: 0.625rem;
		padding: 0.75rem 0.875rem;
		font-size: 0.875rem;
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border: 1px solid color-mix(in srgb, var(--color-warning-text) 22%, transparent);
		border-radius: var(--radius);
		animation: mode-hint-enter 0.24s ease-out 0.5s backwards;
	}

	.mode-hint-icon {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		color: var(--color-warning-bg);
		background: var(--color-warning-text);
		border-radius: 50%;
	}

	.mode-hint-body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.625rem;
		min-width: 0;
		padding-top: 0.125rem;
	}

	.mode-hint-body p {
		margin: 0;
		line-height: 1.45;
	}

	.mode-hint-word {
		font-weight: 700;
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}

	.mode-hint-switch {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4rem 0.875rem;
		font: inherit;
		font-weight: 600;
		color: var(--color-warning-bg);
		background: var(--color-warning-text);
		text-align: start;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.mode-hint-switch:hover {
		opacity: 0.88;
	}

	.mode-hint-switch :global(svg) {
		transition: transform 0.15s;
	}

	.mode-hint-switch:hover :global(svg) {
		transform: translateX(2px);
	}

	@keyframes mode-hint-reveal {
		from {
			grid-template-rows: 0fr;
		}
	}

	@keyframes mode-hint-enter {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mode-hint-reveal,
		.mode-hint {
			animation: none;
		}

		.mode-hint-switch,
		.mode-hint-switch :global(svg) {
			transition: none;
		}
	}
</style>
