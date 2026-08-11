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
	import { t, ti } from '$lib/i18n/index.svelte';
	import { workspaceTabs, type WorkspaceTab } from '$lib/state/workspace-tabs.svelte';
	import { createTabController } from '$lib/utils';

	let tabRefs = $state<HTMLElement[]>([]);

	function tabTitle(tab: WorkspaceTab): string {
		return tab.title ?? t('workspace.tabs.untitled');
	}

	const tabController = createTabController({
		itemCount: () => workspaceTabs.tabs.length,
		getActiveIndex: () =>
			workspaceTabs.tabs.findIndex((tab) => tab.id === workspaceTabs.activeTabId),
		setActiveIndex: (index) => {
			workspaceTabs.activate(workspaceTabs.tabs[index].id);
		},
		focusTab: (index) => tabRefs[index]?.focus()
	});

	function close(tab: WorkspaceTab): void {
		workspaceTabs.close(tab.id);
	}
</script>

<nav class="workspace-tabs" aria-label={t('workspace.tabs.label')}>
	<div class="tabs" role="tablist" aria-label={t('workspace.tabs.label')}>
		{#each workspaceTabs.tabs as tab, index (tab.id)}
			{@const active = tab.id === workspaceTabs.activeTabId}
			<div class="tab" class:active>
				<button
					{@attach (node) => {
						tabRefs[index] = node as HTMLElement;
					}}
					type="button"
					role="tab"
					aria-selected={active}
					tabindex={active ? 0 : -1}
					class="tab-select"
					onclick={() => tabController.activate(index)}
					onkeydown={tabController.onKeydown}
				>
					{tabTitle(tab)}
				</button>
				<button
					type="button"
					class="tab-close"
					aria-label={ti('workspace.tabs.close', { title: tabTitle(tab) })}
					onclick={() => close(tab)}
				>
					<X size={13} strokeWidth={2} aria-hidden="true" />
				</button>
			</div>
		{/each}
	</div>
</nav>

<style>
	.workspace-tabs {
		width: 100%;
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
