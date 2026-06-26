<script lang="ts">
	import type { Component } from 'svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import ChatView from './ChatView.svelte';
	import KeyValueView from './KeyValueView.svelte';
	import GraphView from './GraphView.svelte';

	type ViewId = 'chat' | 'keyValue' | 'graph';

	const views: { id: ViewId; label: TranslationKey; component: Component }[] = [
		{ id: 'chat', label: 'view.chat', component: ChatView },
		{ id: 'keyValue', label: 'view.keyValue', component: KeyValueView },
		{ id: 'graph', label: 'view.graph', component: GraphView }
	];

	let active = $state<ViewId>('chat');
</script>

<section class="workspace">
	<header class="intro">
		<h1>{t('app.title')}</h1>
		<p>{t('app.subtitle')}</p>
	</header>

	<div class="switcher" role="tablist" aria-label={t('view.switcher.label')}>
		{#each views as view (view.id)}
			<button
				type="button"
				role="tab"
				id={`tab-${view.id}`}
				aria-selected={active === view.id}
				aria-controls={`panel-${view.id}`}
				class:active={active === view.id}
				onclick={() => (active = view.id)}
			>
				{t(view.label)}
			</button>
		{/each}
	</div>

	{#each views as view (view.id)}
		{#if active === view.id}
			{@const View = view.component}
			<div class="panel" role="tabpanel" id={`panel-${view.id}`} aria-labelledby={`tab-${view.id}`}>
				<svelte:boundary>
					<View />
					{#snippet failed()}
						<p class="boundary-failed">{t('boundary.failed')}</p>
					{/snippet}
				</svelte:boundary>
			</div>
		{/if}
	{/each}
</section>

<style>
	.workspace {
		max-width: 56rem;
		margin: 0 auto;
		padding: var(--space-4) var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.intro {
		text-align: center;
	}

	.intro h1 {
		margin: 0 0 var(--space-1);
		font-size: 1.6rem;
	}

	.intro p {
		margin: 0;
		color: var(--color-muted);
	}

	.switcher {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		justify-content: center;
	}

	.switcher button {
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		cursor: pointer;
	}

	.switcher button.active {
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.panel {
		min-height: 12rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.boundary-failed {
		margin: 0;
		padding: var(--space-4);
		color: var(--color-muted);
	}
</style>
