<script lang="ts">
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	interface Props {
		onEditRequest: () => void;
	}
	let { onEditRequest }: Props = $props();

	const render = $derived(request.currentRender);
	const imageUrl = $derived(render?.outputUrls[0]);
</script>

{#if render && imageUrl}
	<section class="result">
		<div class="image-card">
			<img src={imageUrl} alt={t('render.generate')} class="output" />
		</div>
		<div class="footer">
			<div class="meta">
				<span>{ti('render.cost', { cost: render.cost })}</span>
				<span class="sep">·</span>
				<span>{ti('render.balance', { balance: render.balance })}</span>
			</div>
			<div class="actions">
				<a href={imageUrl} download="render.jpg" class="btn btn-secondary">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M12 4v12M12 16l-4-4M12 16l4-4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M4 20h16" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
					</svg>
					{t('render.download')}
				</a>
				<button type="button" class="btn btn-accent" onclick={onEditRequest}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					{t('render.edit')}
				</button>
			</div>
		</div>
	</section>
{/if}

<style>
	.result {
		display: flex;
		flex-direction: column;
		gap: 0;
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		box-shadow: var(--shadow-lg);
	}

	.image-card {
		width: 100%;
		background: var(--color-background);
	}

	.output {
		width: 100%;
		max-height: 480px;
		object-fit: contain;
		display: block;
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.875rem 1.25rem;
		border-top: 1px solid var(--color-border);
		gap: 1rem;
		flex-wrap: wrap;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.sep {
		opacity: 0.4;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: var(--radius);
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.15s,
			border-color 0.15s;
		white-space: nowrap;
	}

	.btn-secondary {
		color: var(--color-text);
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-muted);
	}

	.btn-accent {
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1.5px solid var(--color-accent);
	}

	.btn-accent:hover {
		background: var(--color-accent-hover);
		border-color: var(--color-accent-hover);
	}
</style>
