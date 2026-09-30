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
	interface Props {
		text: string;
		hint: string;
	}

	let { text, hint }: Props = $props();

	const id = $props.id();
	const GAP = 8;
	const VIEWPORT_MARGIN = 8;
	// Keep in sync with .hint-bubble's `max-width: 14rem` below (14rem × 16px
	// root font size = 224px) — used to clamp the bubble within the viewport.
	const TOOLTIP_MAX_WIDTH = 224;

	let visible = $state(false);
	let top = $state(0);
	let left = $state(0);

	function show(event: Event & { currentTarget: HTMLButtonElement }): void {
		const rect = event.currentTarget.getBoundingClientRect();
		const halfWidth = TOOLTIP_MAX_WIDTH / 2;
		top = rect.top - GAP;
		left = Math.min(
			Math.max(rect.left + rect.width / 2, halfWidth + VIEWPORT_MARGIN),
			window.innerWidth - halfWidth - VIEWPORT_MARGIN
		);
		visible = true;
	}

	function hide(): void {
		visible = false;
	}

	// Dismissable without moving the pointer or focus (WCAG 1.4.13).
	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && visible) {
			event.stopPropagation();
			hide();
		}
	}
</script>

<!-- The label itself is the trigger: it lights up on hover/focus and shows
its hint, with no separate info icon next to it. The bubble stays in the DOM
(hidden) so aria-describedby always resolves. -->
<button
	type="button"
	class="hint-label"
	class:active={visible}
	aria-describedby={id}
	onmouseenter={show}
	onmouseleave={hide}
	onfocus={show}
	onblur={hide}
	onkeydown={onKeydown}
>
	{text}
</button>
<span
	{id}
	class="hint-bubble"
	role="tooltip"
	hidden={!visible}
	style:top="{top}px"
	style:left="{left}px"
>
	{hint}
</span>

<style>
	.hint-label {
		display: inline-flex;
		align-items: center;
		margin: -0.2rem -0.45rem;
		padding: 0.2rem 0.45rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		white-space: inherit;
		cursor: help;
		transition:
			background 0.15s,
			box-shadow 0.15s,
			color 0.15s;
	}

	.hint-label.active,
	.hint-label:focus-visible {
		outline: none;
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		box-shadow: 0 0 0 1px var(--color-accent);
		color: var(--color-accent-text);
	}

	/* Explicit type settings: the bubble renders wherever the label sits and
	   must not inherit, say, an uppercase column-header style. */
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
		letter-spacing: normal;
		line-height: 1.3;
		text-align: left;
		text-transform: none;
		white-space: normal;
		box-shadow: var(--shadow-md);
		pointer-events: none;
		/* Same layer as HintIcon's bubble: above every other floating layer. */
		z-index: 1000;
	}

	.hint-bubble[hidden] {
		display: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.hint-label {
			transition: none;
		}
	}
</style>
