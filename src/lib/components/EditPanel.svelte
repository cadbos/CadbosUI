<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';
	import type { RenderResult } from '$lib/state/request.svelte';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	let instruction = $state('');
	let applying = $state(false);
	let error = $state<string | null>(null);
	let previousRender = $state<RenderResult | undefined>(undefined);

	const currentRender = $derived(request.currentRender);
	const canUndo = $derived(previousRender !== undefined);

	function applyTemplate(fill: string): void {
		instruction = fill;
	}

	async function applyEdit(): Promise<void> {
		if (!currentRender || !instruction.trim() || applying) return;
		applying = true;
		error = null;

		const imageUrl = currentRender.outputUrls[0];
		previousRender = currentRender;

		try {
			const response = await fetch('/api/edit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ image: imageUrl, prompt: instruction.trim() })
			});
			if (!response.ok) throw new Error('edit failed');
			const result = await response.json();
			const newRender: RenderResult = {
				id: crypto.randomUUID(),
				outputUrls: [result.outputUrl],
				cost: result.cost,
				balance: result.balance,
				parentId: currentRender.id,
				editOp: { type: 'freeform', instruction: instruction.trim() },
				ts: Date.now()
			};
			request.setCurrentRender(newRender);
			instruction = '';
		} catch {
			error = t('edit.apply');
			previousRender = undefined;
		} finally {
			applying = false;
		}
	}

	function undoEdit(): void {
		if (previousRender) {
			request.setCurrentRender(previousRender);
			previousRender = undefined;
			instruction = '';
		}
	}
</script>

<section class="edit-panel">
	<div class="header">
		<h2>{t('edit.title')}</h2>
		<button type="button" class="close-btn" onclick={onClose} aria-label="Close">✕</button>
	</div>

	<div class="templates">
		<button type="button" class="template-btn" onclick={() => applyTemplate(t('edit.templateReplaceFill'))}>
			{t('edit.templateReplace')}
		</button>
		<button type="button" class="template-btn" onclick={() => applyTemplate(t('edit.templateColorFill'))}>
			{t('edit.templateColor')}
		</button>
	</div>

	<label class="instruction-label">
		<span>{t('edit.instruction')}</span>
		<textarea bind:value={instruction} rows="3" disabled={applying}></textarea>
	</label>

	<div class="actions">
		<button
			type="button"
			disabled={!instruction.trim() || applying || !currentRender}
			onclick={() => void applyEdit()}
		>
			{applying ? t('edit.applying') : t('edit.apply')}
		</button>
		{#if canUndo}
			<button type="button" class="undo-btn" onclick={undoEdit} disabled={applying}>
				{t('edit.undo')}
			</button>
		{/if}
	</div>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</section>

<style>
	.edit-panel {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
	}

	.close-btn {
		padding: var(--space-1);
		background: transparent;
		border: none;
		color: var(--color-muted);
		font: inherit;
		cursor: pointer;
		line-height: 1;
	}

	.templates {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}

	.template-btn {
		padding: var(--space-1) var(--space-2);
		font: inherit;
		font-size: 0.85rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		cursor: pointer;
	}

	.template-btn:hover {
		border-color: var(--color-accent);
	}

	.instruction-label {
		display: grid;
		gap: var(--space-1);
	}

	textarea {
		font: inherit;
		resize: vertical;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
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

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.undo-btn {
		color: var(--color-text);
		background: var(--color-surface);
		border-color: var(--color-border);
	}

	.error {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-danger);
	}
</style>
