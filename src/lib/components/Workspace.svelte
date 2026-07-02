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
	import type { OutputFormat, RenderResult as RenderResultType } from '$lib/state/request.svelte';

	type ViewId = 'chat' | 'keyValue' | 'graph';

	const views: { id: ViewId; label: TranslationKey; component: Component; disabled?: boolean }[] = [
		{ id: 'chat', label: 'view.chat', component: ChatView },
		{ id: 'keyValue', label: 'view.keyValue', component: KeyValueView, disabled: true },
		{ id: 'graph', label: 'view.graph', component: GraphView, disabled: true }
	];

	let activeIndex = $state(0);
	let tabs = $state<HTMLElement[]>([]);
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let showEditPanel = $state(false);

	function activate(index: number): void {
		if (views[index]?.disabled) return;
		activeIndex = index;
		tabs[index]?.focus();
	}

	function onKeydown(event: KeyboardEvent): void {
		const last = views.length - 1;
		let next: number | null = null;
		if (event.key === 'ArrowRight') {
			let candidate = activeIndex === last ? 0 : activeIndex + 1;
			while (views[candidate]?.disabled && candidate !== activeIndex) {
				candidate = candidate === last ? 0 : candidate + 1;
			}
			next = candidate;
		} else if (event.key === 'ArrowLeft') {
			let candidate = activeIndex === 0 ? last : activeIndex - 1;
			while (views[candidate]?.disabled && candidate !== activeIndex) {
				candidate = candidate === 0 ? last : candidate - 1;
			}
			next = candidate;
		} else if (event.key === 'Home') {
			next = views.findIndex((v) => !v.disabled);
		} else if (event.key === 'End') {
			next = views.findLastIndex((v) => !v.disabled);
		}

		if (next !== null && next !== activeIndex) {
			event.preventDefault();
			activate(next);
		}
	}

	const isAuthenticated = $derived(auth.status === 'authenticated');
	const validation = $derived(request.validate());
	const canGenerate = $derived(validation.valid && !submitting && request.status !== 'rendering');

	async function generate(): Promise<void> {
		if (!canGenerate) return;
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

<main class="page">
	<div class="card">
		<header class="intro">
			<h1>{t('app.title')}</h1>
			<p>{t('app.subtitle')}</p>
		</header>

		<section class="step">
			<div class="step-header">
				<span class="step-num" aria-hidden="true">①</span>
				<h2>{t('upload.label')}</h2>
			</div>
			<ImageUpload />
		</section>

		<section class="step">
			<div class="step-header">
				<span class="step-num" aria-hidden="true">②</span>
				<h2>{t('view.switcher.label')}</h2>
				<span class="optional-badge">{t('render.optional')}</span>
			</div>

			<div class="tabs" role="tablist" aria-label={t('view.switcher.label')}>
				{#each views as view, index (view.id)}
					<div class="tab-item">
						<button
							{@attach (node) => {
								tabs[index] = node as HTMLElement;
							}}
							type="button"
							role="tab"
							id={`tab-${view.id}`}
							aria-selected={!view.disabled && activeIndex === index}
							aria-disabled={view.disabled ? 'true' : undefined}
							aria-controls={`panel-${view.id}`}
							tabindex={!view.disabled && activeIndex === index ? 0 : -1}
							class:active={!view.disabled && activeIndex === index}
							class:tab-disabled={view.disabled}
							onclick={() => activate(index)}
							onkeydown={onKeydown}
						>
							{t(view.label)}
						</button>
						{#if view.disabled}
							<span class="coming-soon">{t('view.comingSoon')}</span>
						{/if}
					</div>
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

		<section class="generate-section">
			<label class="format-label">
				<span class="format-text">{t('render.outputFormat')}</span>
				<select
					value={request.outputFormat}
					onchange={(event) => request.setOutputFormat(event.currentTarget.value as OutputFormat)}
					class="format-select"
				>
					<option value="webp">WebP</option>
					<option value="jpg">JPG</option>
					<option value="png">PNG</option>
					<option value="avif">AVIF</option>
				</select>
			</label>

			{#if !isAuthenticated}
				<p class="auth-hint">{t('render.signInToGenerate')}</p>
			{/if}

			<button
				type="button"
				class="generate-btn"
				disabled={!canGenerate || !isAuthenticated}
				onclick={() => void generate()}
			>
				{#if request.status === 'rendering'}
					<span class="spinner" aria-hidden="true"></span>
					{t('render.generating')}
				{:else}
					{t('render.generate')}
				{/if}
			</button>

			{#if submitError}
				<p class="submit-error" role="alert">{submitError}</p>
			{/if}
		</section>
	</div>

	{#if request.currentRender}
		<div class="result-wrap">
			<svelte:boundary>
				<RenderResult onEditRequest={() => (showEditPanel = !showEditPanel)} />
				{#snippet failed()}
					<p class="boundary-failed">{t('boundary.failed')}</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{/if}

	{#if showEditPanel && request.currentRender}
		<div class="result-wrap">
			<svelte:boundary>
				<EditPanel onClose={() => (showEditPanel = false)} />
				{#snippet failed()}
					<p class="boundary-failed">{t('boundary.failed')}</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{/if}
</main>

<style>
	.page {
		min-height: 100dvh;
		padding: 2rem 1rem 4rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
	}

	.card {
		width: 100%;
		max-width: 640px;
		background: var(--color-surface);
		border-radius: 20px;
		box-shadow:
			0 1px 3px rgb(0 0 0 / 0.06),
			0 8px 32px rgb(0 0 0 / 0.08);
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.intro {
		text-align: center;
	}

	.intro h1 {
		margin: 0 0 0.4rem;
		font-size: 1.75rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--color-text);
	}

	.intro p {
		margin: 0;
		color: var(--color-muted);
		font-size: 1rem;
	}

	.step {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.step-header {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.step-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font-size: 0.8rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.step-header h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

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

	.tab-item button.tab-disabled {
		opacity: 0.45;
		pointer-events: none;
		cursor: not-allowed;
	}

	.coming-soon {
		font-size: 0.6875rem;
		color: var(--color-muted);
		text-align: center;
	}

	.panel {
		border-radius: 12px;
	}

	.panel[hidden] {
		display: none;
	}

	.boundary-failed {
		margin: 0;
		padding: 1.5rem;
		color: var(--color-muted);
		text-align: center;
	}

	.generate-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.format-label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.875rem;
	}

	.format-text {
		color: var(--color-muted);
		white-space: nowrap;
	}

	.format-select {
		font: inherit;
		font-size: 0.875rem;
		padding: 0.35rem 0.625rem;
		border: 1.5px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		cursor: pointer;
	}

	.auth-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
		text-align: center;
	}

	.generate-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.9rem 1.5rem;
		font: inherit;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: none;
		border-radius: 12px;
		cursor: pointer;
		transition:
			background 0.15s,
			transform 0.1s,
			box-shadow 0.15s;
		box-shadow:
			0 1px 2px rgb(0 0 0 / 0.1),
			0 4px 12px rgb(47 111 79 / 0.3);
	}

	.generate-btn:hover:not(:disabled) {
		background: var(--color-accent-hover);
		box-shadow:
			0 2px 4px rgb(0 0 0 / 0.1),
			0 6px 16px rgb(47 111 79 / 0.35);
		transform: translateY(-1px);
	}

	.generate-btn:active:not(:disabled) {
		transform: translateY(0);
	}

	.generate-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		box-shadow: none;
	}

	.spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid rgb(255 255 255 / 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.submit-error {
		margin: 0;
		color: var(--color-danger);
		font-size: 0.875rem;
		text-align: center;
	}

	.result-wrap {
		width: 100%;
		max-width: 640px;
	}
</style>
