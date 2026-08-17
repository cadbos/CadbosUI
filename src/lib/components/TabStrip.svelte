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
	import { ChevronLeft, ChevronRight, X } from '@lucide/svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { createTabController } from '$lib/utils';

	export interface TabStripItem {
		id: string;
		title: string | null;
		renamable?: boolean; // defaults to true when omitted
	}

	interface Props {
		tabs: TabStripItem[];
		activeId: string;
		ariaLabel: string;
		untitledLabel: string;
		closeLabel: (title: string) => string;
		scrollPrevLabel: string;
		scrollNextLabel: string;
		renameLabel: (title: string) => string;
		renameFailedLabel: string;
		onActivate: (id: string) => void;
		onClose: (id: string) => void;
		onRename: (id: string, title: string) => Promise<void>;
	}

	let {
		tabs,
		activeId,
		ariaLabel,
		untitledLabel,
		closeLabel,
		scrollPrevLabel,
		scrollNextLabel,
		renameLabel,
		renameFailedLabel,
		onActivate,
		onClose,
		onRename
	}: Props = $props();

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

	// Which tab (if any) currently shows a rename `<input>` in place of its
	// `.tab-select` button — see startRename/commitRename/cancelRename below.
	let editingId = $state<string | null>(null);
	let renameDraft = $state('');
	let renameError = $state(false);
	let renamePending = $state(false);

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

	// Plain reference rather than $state: only read from event handlers and
	// attach callbacks, never from the template, so it doesn't need reactivity.
	let viewportEl: HTMLElement | null = null;
	let canScrollPrev = $state(false);
	let canScrollNext = $state(false);

	// Plain references (not $state) to the scroll-nav chevron nodes — only read
	// from updateScrollState to redirect focus before a chevron disappears,
	// same non-reactive pattern as viewportEl above.
	let scrollPrevEl: HTMLElement | null = null;
	let scrollNextEl: HTMLElement | null = null;

	function registerScrollPrev(node: HTMLElement): () => void {
		scrollPrevEl = node;
		return () => {
			scrollPrevEl = null;
		};
	}

	function registerScrollNext(node: HTMLElement): () => void {
		scrollNextEl = node;
		return () => {
			scrollNextEl = null;
		};
	}

	// Sub-pixel layout rounding can leave scrollLeft/scrollWidth a fraction of a
	// pixel short of "fully scrolled", which would otherwise flicker a chevron
	// visible when there's nowhere left to actually scroll.
	const SCROLL_EDGE_TOLERANCE_PX = 1;

	function updateScrollState(): void {
		if (!viewportEl) return;
		const nextCanScrollPrev = viewportEl.scrollLeft > SCROLL_EDGE_TOLERANCE_PX;
		const nextCanScrollNext =
			viewportEl.scrollLeft + viewportEl.clientWidth <
			viewportEl.scrollWidth - SCROLL_EDGE_TOLERANCE_PX;

		// A focused chevron that's about to be hidden would otherwise drop focus
		// to <body> — move it to the active tab first, mirroring close()'s and
		// commitRename()'s own focus-recovery via tabRefs.
		if (canScrollPrev && !nextCanScrollPrev && document.activeElement === scrollPrevEl) {
			tabRefs.get(activeId)?.focus({ preventScroll: true });
		}
		if (canScrollNext && !nextCanScrollNext && document.activeElement === scrollNextEl) {
			tabRefs.get(activeId)?.focus({ preventScroll: true });
		}

		canScrollPrev = nextCanScrollPrev;
		canScrollNext = nextCanScrollNext;
	}

	function handleWheel(event: WheelEvent): void {
		if (!viewportEl || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
		// Vertical wheel input is otherwise dead over the strip (nothing here
		// scrolls vertically), so redirect it into horizontal tab scrolling.
		event.preventDefault();
		viewportEl.scrollBy({ left: event.deltaY });
	}

	function registerViewport(node: HTMLElement): () => void {
		viewportEl = node;
		updateScrollState();
		node.addEventListener('scroll', updateScrollState);
		// Svelte's onwheel is passive by default, which would silently drop
		// preventDefault() below — this needs an explicit non-passive listener.
		node.addEventListener('wheel', handleWheel, { passive: false });
		const resizeObserver = new ResizeObserver(updateScrollState);
		resizeObserver.observe(node);
		return () => {
			node.removeEventListener('scroll', updateScrollState);
			node.removeEventListener('wheel', handleWheel);
			resizeObserver.disconnect();
			viewportEl = null;
		};
	}

	// The viewport's own box doesn't resize when tabs are added/removed/resized
	// (overflow just changes), so content growth needs its own observer.
	function observeContent(node: HTMLElement): () => void {
		const resizeObserver = new ResizeObserver(updateScrollState);
		resizeObserver.observe(node);
		return () => resizeObserver.disconnect();
	}

	function scrollByPage(direction: -1 | 1): void {
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		viewportEl?.scrollBy({
			left: direction * viewportEl.clientWidth * 0.8,
			behavior: reducedMotion ? 'auto' : 'smooth'
		});
	}

	// Deliberately not Element.scrollIntoView: it walks every scrollable
	// ancestor, not just `.tabs-viewport`, so it would also drag the page
	// itself (document/body) around. Also not node.offsetLeft: none of
	// .tabs-viewport/.tabs/.tab are positioned, so offsetLeft resolves against
	// a far ancestor (e.g. <body>), not the viewport — getBoundingClientRect
	// gives a viewport-relative measurement regardless of that, and reading a
	// rect never scrolls anything on its own.
	function scrollActiveTabIntoView(): void {
		const node = tabRefs.get(activeId);
		if (!node || !viewportEl) return;
		const nodeRect = node.getBoundingClientRect();
		const viewportRect = viewportEl.getBoundingClientRect();
		const nodeStart = viewportEl.scrollLeft + (nodeRect.left - viewportRect.left);
		const nodeEnd = nodeStart + nodeRect.width;
		const viewStart = viewportEl.scrollLeft;
		const viewEnd = viewStart + viewportEl.clientWidth;
		if (nodeStart < viewStart) {
			viewportEl.scrollLeft = nodeStart;
		} else if (nodeEnd > viewEnd) {
			viewportEl.scrollLeft = nodeEnd - viewportEl.clientWidth;
		}
	}

	const tabController = createTabController({
		itemCount: () => tabs.length,
		getActiveIndex: () => tabs.findIndex((tab) => tab.id === activeId),
		setActiveIndex: (index) => onActivate(tabs[index].id),
		focusTab: (index) => tabRefs.get(tabs[index]?.id ?? '')?.focus({ preventScroll: true })
	});

	// `tabRefs` is a SvelteMap, so this re-runs both on activation and once a
	// brand-new tab's button registers its own ref — covering the case where
	// activeId already points at a tab that hasn't mounted yet. Already being
	// fully in view is a no-op above, so this never fights the user's own
	// manual scroll/drag.
	//
	// Guarded on activeId actually having changed since the last time this ran
	// (rather than acting on every incidental re-run, e.g. a tabRefs mutation
	// unrelated to activation) so auto-scroll is scoped strictly to "a new tab
	// just became active" — it can never fight a user's own manual scroll-nav
	// interaction.
	let lastScrolledActiveId: string | null = null;

	$effect(() => {
		if (activeId === lastScrolledActiveId) return;
		lastScrolledActiveId = activeId;
		scrollActiveTabIntoView();
	});

	function close(tab: TabStripItem): void {
		onClose(tab.id);
		// The closed tab's own button (which had focus, since that's the only
		// way to reach it via keyboard) is gone from the DOM after this — move
		// focus to the newly active tab once the #each block has re-rendered,
		// rather than letting it silently fall back to <body>.
		requestAnimationFrame(() => {
			const next = tabs.find((candidate) => candidate.id === activeId);
			if (next) tabRefs.get(next.id)?.focus({ preventScroll: true });
		});
	}

	// Stashed by the rename input's own {@attach} while it's mounted — used to
	// reclaim focus after a failed commit, since the input stays mounted
	// (editingId isn't cleared) but the native blur() that triggered the
	// commit has already moved focus away by the time the catch branch runs.
	let renameInputEl: HTMLInputElement | null = null;

	function startRename(tab: TabStripItem): void {
		if (tab.renamable === false) return;
		editingId = tab.id;
		renameDraft = tabTitle(tab);
		renameError = false;
	}

	// Moves focus back to the tab's own button once the #each block has
	// swapped the rename input back out for it — same rAF-deferred pattern as
	// close() above, and for the same reason: the button doesn't exist in the
	// DOM again until the next tick.
	function focusTabButton(tab: TabStripItem): void {
		requestAnimationFrame(() => {
			tabRefs.get(tab.id)?.focus({ preventScroll: true });
		});
	}

	function cancelRename(tab: TabStripItem): void {
		editingId = null;
		renameError = false;
		focusTabButton(tab);
	}

	// The single code path that actually commits a rename — reached both from
	// the input's onblur and, via the input's own onkeydown calling .blur()
	// on Enter, indirectly through the same onblur. Guarded on editingId
	// still pointing at this tab because removing the focused input from the
	// DOM (as cancelRename does on Escape) can itself dispatch a native blur
	// on the way out, which would otherwise re-enter this function after the
	// cancel already ran.
	async function commitRename(tab: TabStripItem): Promise<void> {
		if (editingId !== tab.id) return;
		const trimmed = renameDraft.trim();
		if (trimmed === '' || trimmed === tabTitle(tab)) {
			editingId = null;
			renameError = false;
			return;
		}
		if (renamePending) return;
		renamePending = true;
		renameError = false;
		try {
			await onRename(tab.id, trimmed);
			editingId = null;
			focusTabButton(tab);
		} catch {
			renameError = true;
			// The blur() that triggered this commit already moved focus away, and
			// the input is still disabled (renamePending only flips back below) so
			// focus() would be a no-op right now — same rAF-deferred pattern as
			// focusTabButton, to wait for the DOM update that re-enables it.
			requestAnimationFrame(() => {
				renameInputEl?.focus({ preventScroll: true });
			});
		} finally {
			renamePending = false;
		}
	}

	function onRenameKeydown(event: KeyboardEvent, tab: TabStripItem): void {
		if (event.key === 'Enter') {
			(event.currentTarget as HTMLInputElement).blur();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelRename(tab);
		}
	}

	// Shared keydown handler for the (non-editing) tab button: F2 opens rename
	// mode (matching the Explorer/VS Code convention) and Delete/Backspace
	// closes the tab, both otherwise unreachable now that .tab-close is a
	// roving-tabindex stop rather than always being its own Tab-order entry.
	// Anything else delegates to the tablist's own arrow-key navigation.
	function handleTabKeydown(event: KeyboardEvent, tab: TabStripItem): void {
		if (event.key === 'F2') {
			if (tab.renamable === false) return;
			event.preventDefault();
			startRename(tab);
			return;
		}
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			close(tab);
			return;
		}
		tabController.onKeydown(event);
	}
</script>

<nav class="tab-strip" aria-label={ariaLabel}>
	{#if canScrollPrev}
		<button
			type="button"
			class="tab-scroll"
			aria-label={scrollPrevLabel}
			onclick={() => scrollByPage(-1)}
			{@attach registerScrollPrev}
		>
			<ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
		</button>
	{/if}
	<div
		class="tabs-viewport"
		class:fade-start={canScrollPrev}
		class:fade-end={canScrollNext}
		{@attach registerViewport}
	>
		<div class="tabs" role="tablist" aria-label={ariaLabel} {@attach observeContent}>
			{#each tabs as tab, index (tab.id)}
				{@const active = tab.id === activeId}
				<div class="tab" class:active>
					{#if editingId === tab.id}
						{@const renameErrorId = `${tab.id}-rename-error`}
						<div class="tab-rename">
							<input
								type="text"
								class="tab-select"
								class:error={renameError}
								maxlength="200"
								disabled={renamePending}
								role="tab"
								aria-selected={active}
								aria-label={renameLabel(tabTitle(tab))}
								aria-describedby={renameErrorId}
								bind:value={renameDraft}
								{@attach (node: HTMLInputElement) => {
									renameInputEl = node;
									node.focus({ preventScroll: true });
									node.select();
									return () => {
										renameInputEl = null;
									};
								}}
								onblur={() => commitRename(tab)}
								onkeydown={(event) => onRenameKeydown(event, tab)}
							/>
							<span id={renameErrorId} class="rename-error" role="alert"
								>{renameError ? renameFailedLabel : ''}</span
							>
						</div>
					{:else}
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
							ondblclick={() => startRename(tab)}
							onkeydown={(event) => handleTabKeydown(event, tab)}
						>
							{tabTitle(tab)}
						</button>
					{/if}
					<button
						type="button"
						class="tab-close"
						tabindex={active ? 0 : -1}
						aria-label={closeLabel(tabTitle(tab))}
						onclick={() => close(tab)}
					>
						<X size={13} strokeWidth={2} aria-hidden="true" />
					</button>
				</div>
			{/each}
		</div>
	</div>
	{#if canScrollNext}
		<button
			type="button"
			class="tab-scroll"
			aria-label={scrollNextLabel}
			onclick={() => scrollByPage(1)}
			{@attach registerScrollNext}
		>
			<ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
		</button>
	{/if}
</nav>

<style>
	.tab-strip {
		display: flex;
		align-items: flex-end;
		flex: 1 1 0%;
		min-width: 0;
		gap: 0.125rem;
	}

	.tabs-viewport {
		flex: 1 1 0%;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
		--fade-start: 0rem;
		--fade-end: 0rem;
		mask-image: linear-gradient(
			to right,
			transparent,
			black var(--fade-start),
			black calc(100% - var(--fade-end)),
			transparent 100%
		);
		-webkit-mask-image: linear-gradient(
			to right,
			transparent,
			black var(--fade-start),
			black calc(100% - var(--fade-end)),
			transparent 100%
		);
	}

	.tabs-viewport::-webkit-scrollbar {
		display: none;
	}

	.tabs-viewport.fade-start {
		--fade-start: 1.5rem;
	}

	.tabs-viewport.fade-end {
		--fade-end: 1.5rem;
	}

	.tabs {
		display: flex;
		align-items: flex-end;
		gap: 0.25rem;
	}

	.tab-scroll {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		margin-bottom: 0.375rem;
		padding: 0;
		border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-surface) 70%, transparent);
		color: var(--color-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.tab-scroll:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 0 0 auto;
		max-width: 12rem;
		padding: 0.5rem 0.5rem 0.5rem 0.875rem;
		border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
		border-bottom: none;
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		background: color-mix(in srgb, var(--color-surface) 55%, transparent);
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.tab.active {
		background: var(--color-background);
	}

	.tab:not(.active):hover {
		background: color-mix(in srgb, var(--color-surface-hover) 80%, transparent);
	}

	.tab-select {
		overflow: hidden;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-muted-strong);
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

	input.tab-select {
		cursor: text;
	}

	input.tab-select.error {
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-sm);
	}

	.tab-rename {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.rename-error {
		font-size: 0.6875rem;
		line-height: 1.2;
		color: var(--color-danger);
		white-space: nowrap;
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

	@media (prefers-reduced-motion: reduce) {
		.tab,
		.tab-scroll,
		.tab-close {
			transition: none;
		}
	}
</style>
