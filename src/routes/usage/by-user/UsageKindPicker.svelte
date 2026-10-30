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
	import { ChevronDown } from '@lucide/svelte';
	import type { GenerationKind, GenerationKindCount } from '$lib/api/contract';
	import { t } from '$lib/i18n/index.svelte';
	import { placeBelow } from '../popover-placement';
	import { formatGenerationKind } from '../usage-format';
	import UsageNumber from '../UsageNumber.svelte';

	interface Props {
		selected: GenerationKind;
		// The day's kinds to switch between.
		kinds: GenerationKindCount[];
		// The page for a kind; all kinds when null.
		kindHref: (kind: GenerationKind | null) => string;
	}

	let { selected, kinds, kindHref }: Props = $props();

	const POPOVER_MAX_WIDTH_REM = 16;

	let trigger: HTMLButtonElement | null = null;
	let placement = $state({ top: 0, left: 0, arrowLeft: 0 });
	const popoverId = $props.id();

	function registerTrigger(node: HTMLButtonElement): () => void {
		trigger = node;
		return () => {
			trigger = null;
		};
	}

	function open(event: ToggleEvent): void {
		if (event.newState === 'open' && trigger) {
			placement = placeBelow(trigger, POPOVER_MAX_WIDTH_REM, 'start');
		}
	}

	function close(event: MouseEvent): void {
		(event.currentTarget as HTMLElement).closest<HTMLElement>('[popover]')?.hidePopover();
	}
</script>

<button
	{@attach registerTrigger}
	type="button"
	class="kind-trigger"
	popovertarget={popoverId}
	aria-haspopup="true"
>
	{formatGenerationKind(selected)}
	<ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
</button>
<nav
	id={popoverId}
	popover="auto"
	aria-label={t('usage.kinds.title')}
	class="kind-popover"
	style:top="{placement.top}px"
	style:left="{placement.left}px"
	onbeforetoggle={open}
>
	<ul>
		<li>
			<a href={kindHref(null)} data-sveltekit-noscroll onclick={close}>{t('usage.kinds.all')}</a>
		</li>
		{#each kinds as entry (entry.kind)}
			<li>
				<a
					href={kindHref(entry.kind)}
					aria-current={entry.kind === selected ? 'true' : undefined}
					data-sveltekit-noscroll
					onclick={close}
				>
					<span>{formatGenerationKind(entry.kind)}</span>
					<UsageNumber kind="count" value={entry.count} />
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.kind-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem 0.375rem 0.75rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-accent-text);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	.kind-trigger:hover {
		background: var(--color-surface-hover);
	}

	.kind-popover {
		position: absolute;
		inset: auto;
		box-sizing: border-box;
		width: min(16rem, calc(100vw - 2rem));
		margin: 0;
		padding: 0.375rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	ul {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0.625rem;
		border-radius: var(--radius-sm);
		color: var(--color-text);
		font-size: 0.875rem;
		text-decoration: none;
	}

	a:hover,
	a:focus-visible {
		background: var(--color-surface-hover);
	}

	a[aria-current='true'] {
		color: var(--color-accent-text);
		font-weight: 700;
	}
</style>
