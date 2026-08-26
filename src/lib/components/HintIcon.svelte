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
	import { Info } from '@lucide/svelte';

	interface Props {
		label: string;
	}

	let { label }: Props = $props();

	const GAP = 8;
	const VIEWPORT_MARGIN = 8;
	// Keep in sync with .hint-bubble's `max-width: 14rem` below (14rem × 16px
	// root font size = 224px) — used to clamp the bubble's horizontal position
	// within the viewport, so a mismatch would silently miscentre or clip it.
	const TOOLTIP_MAX_WIDTH = 224;

	let triggerEl: HTMLButtonElement | undefined = $state();
	let visible = $state(false);
	let top = $state(0);
	let left = $state(0);

	function show(): void {
		if (!triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		const halfWidth = TOOLTIP_MAX_WIDTH / 2;
		const center = rect.left + rect.width / 2;
		top = rect.top - GAP;
		left = Math.min(
			Math.max(center, halfWidth + VIEWPORT_MARGIN),
			window.innerWidth - halfWidth - VIEWPORT_MARGIN
		);
		visible = true;
	}

	function hide(): void {
		visible = false;
	}
</script>

<button
	type="button"
	class="hint-icon"
	aria-label={label}
	bind:this={triggerEl}
	onmouseenter={show}
	onmouseleave={hide}
	onfocus={show}
	onblur={hide}
>
	<Info size={15} strokeWidth={1.8} aria-hidden="true" />
</button>

{#if visible}
	<span class="hint-bubble" aria-hidden="true" style:top="{top}px" style:left="{left}px">
		{label}
	</span>
{/if}

<style>
	.hint-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 1.125rem;
		height: 1.125rem;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted);
		cursor: help;
		transition: color 0.15s;
	}

	.hint-icon:hover,
	.hint-icon:focus-visible {
		color: var(--color-accent-text);
	}

	.hint-bubble {
		position: fixed;
		transform: translate(-50%, -100%);
		width: max-content;
		max-width: 14rem;
		padding: 0.35rem 0.6rem;
		border-radius: var(--radius-sm);
		background: var(--color-text);
		color: var(--color-surface);
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.3;
		white-space: normal;
		box-shadow: var(--shadow-md);
		pointer-events: none;
		/* Above every other floating layer in the app (header: 30,
		   --z-scenes-panel: 20, --z-tools-panel: 10, GenerationOverlay: 100) so
		   this fixed-position tooltip is never occluded, regardless of which
		   panel it happens to render over. */
		z-index: 1000;
	}

	@media (prefers-reduced-motion: reduce) {
		.hint-icon {
			transition: none;
		}
	}
</style>
