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
	import type { Component } from 'svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import ChatView from '$lib/components/ChatView.svelte';
	import KeyValueView from '$lib/components/KeyValueView.svelte';
	import GraphView from '$lib/components/GraphView.svelte';
	import { createTabController, logBoundaryError } from '$lib/utils';

	type ViewId = 'chat' | 'keyValue' | 'graph';

	interface Props {
		stepLabel: string;
		headingKey?: TranslationKey;
		optionalBadgeKey?: TranslationKey;
	}

	let {
		stepLabel,
		headingKey = 'view.switcher.label',
		optionalBadgeKey = undefined
	}: Props = $props();

	const views: { id: ViewId; label: TranslationKey; component: Component }[] = [
		{ id: 'chat', label: 'view.chat', component: ChatView },
		{ id: 'keyValue', label: 'view.keyValue', component: KeyValueView },
		{ id: 'graph', label: 'view.graph', component: GraphView }
	];

	let activeIndex = $state(0);
	let tabs = $state<HTMLElement[]>([]);

	const viewTabs = createTabController({
		itemCount: () => views.length,
		getActiveIndex: () => activeIndex,
		setActiveIndex: (index) => {
			activeIndex = index;
		},
		focusTab: (index) => tabs[index]?.focus()
	});
</script>

<section class="step-card">
	<div class="step-header">
		<span class="step-num" aria-hidden="true">{stepLabel}</span>
		<h2>{t(headingKey)}</h2>
		{#if optionalBadgeKey}
			<span class="optional-badge">{t(optionalBadgeKey)}</span>
		{/if}
	</div>

	<div class="tabs" role="tablist" aria-label={t(headingKey)}>
		{#each views as view, index (view.id)}
			<div class="tab-item">
				<button
					{@attach (node) => {
						tabs[index] = node as HTMLElement;
					}}
					type="button"
					role="tab"
					id={`tab-${view.id}-${stepLabel}`}
					aria-selected={activeIndex === index}
					aria-controls={`panel-${view.id}-${stepLabel}`}
					tabindex={activeIndex === index ? 0 : -1}
					class:active={activeIndex === index}
					onclick={() => viewTabs.activate(index)}
					onkeydown={viewTabs.onKeydown}
				>
					{t(view.label)}
				</button>
			</div>
		{/each}
	</div>

	{#each views as view, index (view.id)}
		{@const View = view.component}
		<div
			class="panel"
			role="tabpanel"
			id={`panel-${view.id}-${stepLabel}`}
			aria-labelledby={`tab-${view.id}-${stepLabel}`}
			tabindex="0"
			hidden={activeIndex !== index}
		>
			<svelte:boundary
				onerror={(error: unknown) => logBoundaryError(`promptViews.${view.id}`, error)}
			>
				<View />
				{#snippet failed(_error: unknown, reset: () => void)}
					<p class="boundary-failed">{t('boundary.failed')}</p>
					<button type="button" class="boundary-retry" onclick={reset}>
						{t('boundary.retry')}
					</button>
				{/snippet}
			</svelte:boundary>
		</div>
	{/each}
</section>

<style>
	.optional-badge {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-muted);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		padding: 0.15rem 0.5rem;
		border-radius: 100px;
	}

	.tabs {
		display: flex;
		gap: 0.5rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 12px;
	}

	.tab-item {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
	}

	.tab-item button {
		width: 100%;
		padding: 0.5rem 0.75rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 10px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
		text-align: center;
	}

	.tab-item button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
	}

	.panel {
		border-radius: 12px;
	}

	.panel[hidden] {
		display: none;
	}
</style>
