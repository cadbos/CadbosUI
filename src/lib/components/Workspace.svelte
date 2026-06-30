<script lang="ts">
	import type { Component } from 'svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import ChatView from '$lib/components/ChatView.svelte';
	import KeyValueView from '$lib/components/KeyValueView.svelte';
	import GraphView from '$lib/components/GraphView.svelte';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import RenderResult from '$lib/components/RenderResult.svelte';
	import EditPanel from '$lib/components/EditPanel.svelte';
	import { request } from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import type { RenderResult as RenderResultType } from '$lib/state/request.svelte';

	type ViewId = 'chat' | 'keyValue' | 'graph';

	const views: { id: ViewId; label: TranslationKey; component: Component }[] = [
		{ id: 'chat', label: 'view.chat', component: ChatView },
		{ id: 'keyValue', label: 'view.keyValue', component: KeyValueView },
		{ id: 'graph', label: 'view.graph', component: GraphView }
	];

	let activeIndex = $state(0);
	let tabs = $state<HTMLElement[]>([]);
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let showEditPanel = $state(false);

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

	async function generate(): Promise<void> {
		const validation = request.validate();
		if (!validation.valid || submitting) return;
		submitting = true;
		submitError = null;
		request.setStatus('rendering');
		try {
			const body = request.toRenderRequest();
			const response = await fetch('/api/render', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) throw new Error('render failed');
			const result = await response.json();
			const render: RenderResultType = {
				id: crypto.randomUUID(),
				outputUrls: [result.outputUrl],
				cost: result.cost,
				balance: result.balance,
				ts: Date.now()
			};
			request.setCurrentRender(render);
			request.setStatus('idle');
			showEditPanel = false;
		} catch {
			request.setStatus('error');
			submitError = t('render.generate');
		} finally {
			submitting = false;
		}
	}
</script>

<section class="workspace">
	<header class="intro">
		<h1>{t('app.title')}</h1>
		<p>{t('app.subtitle')}</p>
	</header>

	<ImageUpload />

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

	<section class="generate-section">
		<div class="format-row">
			<label>
				<span>{t('render.outputFormat')}</span>
				<select bind:value={request.outputFormat}>
					<option value="webp">WebP</option>
					<option value="jpg">JPG</option>
					<option value="png">PNG</option>
					<option value="avif">AVIF</option>
				</select>
			</label>
		</div>
		<button
			type="button"
			class="generate-btn"
			disabled={submitting || request.status === 'rendering' || auth.status !== 'authenticated'}
			onclick={() => void generate()}
		>
			{request.status === 'rendering' ? t('render.generating') : t('render.generate')}
		</button>
		{#if submitError}
			<p class="submit-error" role="alert">{submitError}</p>
		{/if}
	</section>

	{#if request.currentRender}
		<svelte:boundary>
			<RenderResult onEditRequest={() => (showEditPanel = !showEditPanel)} />
			{#snippet failed()}
				<p class="boundary-failed">{t('boundary.failed')}</p>
			{/snippet}
		</svelte:boundary>
	{/if}

	{#if showEditPanel && request.currentRender}
		<svelte:boundary>
			<EditPanel onClose={() => (showEditPanel = false)} />
			{#snippet failed()}
				<p class="boundary-failed">{t('boundary.failed')}</p>
			{/snippet}
		</svelte:boundary>
	{/if}
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

	label {
		display: grid;
		gap: var(--space-1);
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
		padding: var(--space-3);
	}

	.panel[hidden] {
		display: none;
	}

	.boundary-failed {
		margin: 0;
		padding: var(--space-4);
		color: var(--color-muted);
	}

	.generate-section {
		display: grid;
		gap: var(--space-2);
	}

	.format-row {
		display: flex;
		align-items: end;
		gap: var(--space-2);
	}

	select {
		font: inherit;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.generate-btn {
		padding: var(--space-2) var(--space-4);
		font: inherit;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
		cursor: pointer;
		width: 100%;
	}

	.generate-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.submit-error {
		margin: 0;
		color: var(--color-danger);
		font-size: 0.85rem;
	}
</style>
