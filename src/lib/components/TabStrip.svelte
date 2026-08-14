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
	import { X } from '@lucide/svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { createTabController } from '$lib/utils';

	export interface TabStripItem {
		id: string;
		title: string | null;
	}

	interface Props {
		tabs: TabStripItem[];
		activeId: string;
		ariaLabel: string;
		untitledLabel: string;
		closeLabel: (title: string) => string;
		onActivate: (id: string) => void;
		onClose: (id: string) => void;
	}

	let { tabs, activeId, ariaLabel, untitledLabel, closeLabel, onActivate, onClose }: Props =
		$props();

	// Keyed by tab id rather than each-block index: a tab closing shifts
	// every survivor's index, but its id never changes, so keying this way
	// means the attach's own teardown (below) is enough to drop exactly the
	// closed tab's entry — no separate effect needed to reconcile stale
	// trailing slots against the current `tabs` length.
	let tabRefs = new SvelteMap<string, HTMLElement>();
	// Whether each tab's label is currently clipped by its own max-width —
	// only then does it get a `title` tooltip, so hovering a short label that
	// already fits doesn't pop up a redundant native tooltip.
	let truncated = $state<Record<string, boolean>>({});

	function tabTitle(tab: TabStripItem): string {
		return tab.title ?? untitledLabel;
	}

	function setTruncated(id: string, value: boolean): void {
		if (truncated[id] === value) return;
		truncated = { ...truncated, [id]: value };
	}

	// Deliberately doesn't clear its own entry from `truncated` on teardown —
	// `truncated` is a single shared object, so every tab's title binding
	// depends on the whole reference, not just its own key. Writing to it from
	// inside an attach's own teardown (e.g. every tab tearing down at once
	// when the whole strip unmounts on navigation) re-triggers those title
	// bindings while they're themselves mid-teardown, which spirals into
	// Svelte's effect_update_depth_exceeded. A leftover entry for a dead tab
	// id is harmless — ids are never reused, and nothing reads it again.
	function measureTruncation(tab: TabStripItem): (node: HTMLElement) => () => void {
		return (node: HTMLElement) => {
			const update = () => setTruncated(tab.id, node.scrollWidth > node.clientWidth);
			update();
			const observer = new ResizeObserver(update);
			observer.observe(node);
			return () => observer.disconnect();
		};
	}

	const tabController = createTabController({
		itemCount: () => tabs.length,
		getActiveIndex: () => tabs.findIndex((tab) => tab.id === activeId),
		setActiveIndex: (index) => onActivate(tabs[index].id),
		focusTab: (index) => tabRefs.get(tabs[index]?.id ?? '')?.focus()
	});

	function close(tab: TabStripItem): void {
		onClose(tab.id);
		// The closed tab's own button (which had focus, since that's the only
		// way to reach it via keyboard) is gone from the DOM after this — move
		// focus to the newly active tab once the #each block has re-rendered,
		// rather than letting it silently fall back to <body>.
		requestAnimationFrame(() => {
			const next = tabs.find((candidate) => candidate.id === activeId);
			if (next) tabRefs.get(next.id)?.focus();
		});
	}
</script>

<nav class="tab-strip" aria-label={ariaLabel}>
	<div class="tabs" role="tablist" aria-label={ariaLabel}>
		{#each tabs as tab, index (tab.id)}
			{@const active = tab.id === activeId}
			<div class="tab" class:active>
				<button
					{@attach (node) => {
						tabRefs.set(tab.id, node as HTMLElement);
						return () => {
							tabRefs.delete(tab.id);
						};
					}}
					{@attach measureTruncation(tab)}
					type="button"
					role="tab"
					aria-selected={active}
					tabindex={active ? 0 : -1}
					class="tab-select"
					title={truncated[tab.id] ? tabTitle(tab) : undefined}
					onclick={() => tabController.activate(index)}
					onkeydown={tabController.onKeydown}
				>
					{tabTitle(tab)}
				</button>
				<button
					type="button"
					class="tab-close"
					aria-label={closeLabel(tabTitle(tab))}
					onclick={() => close(tab)}
				>
					<X size={13} strokeWidth={2} aria-hidden="true" />
				</button>
			</div>
		{/each}
	</div>
</nav>

<style>
	.tab-strip {
		flex: 1 1 0%;
		min-width: 0;
		overflow-x: auto;
	}

	.tabs {
		display: flex;
		align-items: flex-end;
		gap: 0.25rem;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 0 0 auto;
		max-width: 12rem;
		padding: 0.5rem 0.5rem 0.5rem 0.875rem;
		border: 1px solid var(--color-border);
		border-bottom: none;
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.tab.active {
		background: var(--color-background);
	}

	.tab:not(.active):hover {
		background: var(--color-surface-hover);
	}

	.tab-select {
		overflow: hidden;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-muted);
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.tab.active .tab-select {
		color: var(--color-text);
	}

	.tab-close {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.tab-close:hover {
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		color: var(--color-danger);
	}
</style>
