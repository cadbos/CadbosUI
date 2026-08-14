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

	let tabRefs = $state<HTMLElement[]>([]);
	// Whether each tab's label is currently clipped by its own max-width —
	// only then does it get a `title` tooltip, so hovering a short label that
	// already fits doesn't pop up a redundant native tooltip.
	let truncated = $state<boolean[]>([]);

	function tabTitle(tab: TabStripItem): string {
		return tab.title ?? untitledLabel;
	}

	function setTruncated(index: number, value: boolean): void {
		if (truncated[index] === value) return;
		const next = [...truncated];
		next[index] = value;
		truncated = next;
	}

	function measureTruncation(index: number): (node: HTMLElement) => () => void {
		return (node: HTMLElement) => {
			const update = () => setTruncated(index, node.scrollWidth > node.clientWidth);
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
		focusTab: (index) => tabRefs[index]?.focus()
	});

	function close(tab: TabStripItem): void {
		onClose(tab.id);
		// The closed tab's own button (which had focus, since that's the only
		// way to reach it via keyboard) is gone from the DOM after this — move
		// focus to the newly active tab once the #each block has re-rendered,
		// rather than letting it silently fall back to <body>.
		requestAnimationFrame(() => {
			const activeIndex = tabs.findIndex((candidate) => candidate.id === activeId);
			if (activeIndex !== -1) tabRefs[activeIndex]?.focus();
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
						tabRefs[index] = node as HTMLElement;
					}}
					{@attach measureTruncation(index)}
					type="button"
					role="tab"
					aria-selected={active}
					tabindex={active ? 0 : -1}
					class="tab-select"
					title={truncated[index] ? tabTitle(tab) : undefined}
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
