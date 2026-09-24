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
	import { Lightbulb } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
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

<div class="mode-hint-live" role="status" aria-live="polite" aria-atomic="true">
	{#if hint?.kind === 'switch'}
		{@const target = t(targetLabel(hint.target))}
		<div class="mode-hint">
			<Lightbulb size={16} strokeWidth={1.8} aria-hidden="true" />
			<div class="mode-hint-body">
				<p>{t(INTENT_MESSAGES[hint.intent])} {ti('modeHint.suggestion', { target })}</p>
				<button type="button" class="mode-hint-switch" onclick={() => switchMode(hint.target)}>
					{ti('modeHint.switch', { target })}
				</button>
			</div>
		</div>
	{:else if hint?.kind === 'format'}
		<div class="mode-hint">
			<Lightbulb size={16} strokeWidth={1.8} aria-hidden="true" />
			<div class="mode-hint-body">
				<p>{t(FORMAT_MESSAGES[hint.field])}</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.mode-hint-live:empty {
		display: none;
	}

	.mode-hint {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
		border: 1.5px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
		border-radius: 10px;
	}

	.mode-hint :global(svg) {
		flex-shrink: 0;
		margin-top: 0.125rem;
		color: var(--color-accent-text);
	}

	.mode-hint-body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		min-width: 0;
	}

	.mode-hint-body p {
		margin: 0;
		line-height: 1.4;
	}

	.mode-hint-switch {
		padding: 0.3rem 0.75rem;
		font: inherit;
		font-weight: 600;
		color: var(--color-accent-text);
		background: var(--color-surface);
		border: 1.5px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
		border-radius: 100px;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.mode-hint-switch:hover {
		border-color: var(--color-accent);
	}
</style>
