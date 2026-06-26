<script lang="ts">
	import type { Component } from 'svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import ChatView from '$lib/components/ChatView.svelte';
	import KeyValueView from '$lib/components/KeyValueView.svelte';
	import GraphView from '$lib/components/GraphView.svelte';

	type ViewId = 'chat' | 'keyValue' | 'graph';

	const views: { id: ViewId; label: TranslationKey; component: Component }[] = [
		{ id: 'chat', label: 'view.chat', component: ChatView },
		{ id: 'keyValue', label: 'view.keyValue', component: KeyValueView },
		{ id: 'graph', label: 'view.graph', component: GraphView }
	];

	let activeIndex = $state(0);
	let tabs = $state<HTMLElement[]>([]);

	function activate(index: number): void {
		activeIndex = index;
		tabs[index]?.focus();
	}

	function onKeydown(event: KeyboardEvent): void {
		const last = views.length - 1;
		let next: number | null = null;
		if (event.key === 'ArrowRight') next = activeIndex === last ? 0 : activeIndex + 1;
		else if (event.key === 'ArrowLeft') next = activeIndex === 0 ? last : activeIndex - 1;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = last;

		if (next !== null) {
			event.preventDefault();
			activate(next);
		}
	}
</script>

<section class="workspace">
	<header class="intro">
		<h1>{t('app.title')}</h1>
		<p>{t('app.subtitle')}</p>
	</header>

	<div class="switcher" role="tablist" aria-label={t('view.switcher.label')}>
		{#each views as view, index (view.id)}
			<button
				{@attach (node) => {
					tabs[index] = node as HTMLElement;
				}}
				type="button"
				role="tab"
				id={`tab-${view.id}`}
				aria-selected={activeIndex === index}
				aria-controls={`panel-${view.id}`}
				tabindex={activeIndex === index ? 0 : -1}
				class:active={activeIndex === index}
				onclick={() => activate(index)}
				onkeydown={onKeydown}
			>
				{t(view.label)}
			</button>
		{/each}
	</div>

	{#each views as view, index (view.id)}
		{@const View = view.component}
		<div
			class="panel"
			role="tabpanel"
			id={`panel-${view.id}`}
			aria-labelledby={`tab-${view.id}`}
			tabindex="0"
			hidden={activeIndex !== index}
		>
			<svelte:boundary>
				<View />
				{#snippet failed()}
					<p class="boundary-failed">{t('boundary.failed')}</p>
				{/snippet}
			</svelte:boundary>
		</div>
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

	.panel[hidden] {
		display: none;
	}

	.boundary-failed {
		margin: 0;
		padding: var(--space-4);
		color: var(--color-muted);
	}
</style>
