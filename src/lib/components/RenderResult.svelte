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
		<img src={imageUrl} alt={t('render.generate')} class="output" />
		<div class="meta">
			<span>{ti('render.cost', { cost: render.cost })}</span>
			<span>{ti('render.balance', { balance: render.balance })}</span>
		</div>
		<div class="actions">
			<a href={imageUrl} download="render.jpg" class="download-btn">
				{t('render.download')}
			</a>
			<button type="button" onclick={onEditRequest}>
				{t('render.edit')}
			</button>
		</div>
	</section>
{/if}

<style>
	.result {
		display: grid;
		gap: var(--space-2);
	}

	.output {
		width: 100%;
		max-height: 28rem;
		object-fit: contain;
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.meta {
		display: flex;
		gap: var(--space-3);
		font-size: 0.85rem;
		color: var(--color-muted);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.download-btn {
		display: inline-flex;
		align-items: center;
		padding: var(--space-1) var(--space-2);
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		text-decoration: none;
		font: inherit;
		cursor: pointer;
	}

	button {
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
		cursor: pointer;
	}
</style>
