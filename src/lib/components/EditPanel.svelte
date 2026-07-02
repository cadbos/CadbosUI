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
		<h3>{t('edit.title')}</h3>
		<button type="button" class="close-btn" onclick={onClose} aria-label={t('edit.close')}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M18 6L6 18M6 6l12 12"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</div>

	<div class="chips">
		<button type="button" class="chip" onclick={() => applyTemplate(t('edit.templateReplaceFill'))}>
			{t('edit.templateReplace')}
		</button>
		<button type="button" class="chip" onclick={() => applyTemplate(t('edit.templateColorFill'))}>
			{t('edit.templateColor')}
		</button>
	</div>

	<label class="field">
		<span class="field-label">{t('edit.instruction')}</span>
		<textarea
			bind:value={instruction}
			rows="3"
			disabled={applying}
			placeholder={t('edit.templateReplaceFill')}></textarea>
	</label>

	<div class="actions">
		<button
			type="button"
			class="btn-apply"
			disabled={!instruction.trim() || applying || !currentRender}
			onclick={() => void applyEdit()}
		>
			{#if applying}
				<span class="spinner" aria-hidden="true"></span>
			{/if}
			{applying ? t('edit.applying') : t('edit.apply')}
		</button>
		{#if canUndo}
			<button type="button" class="btn-undo" onclick={undoEdit} disabled={applying}>
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
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem 1.5rem 1.5rem;
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-left: 4px solid var(--color-accent);
		border-radius: 16px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.07);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--color-muted);
		border-radius: 8px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.close-btn:hover {
		background: var(--color-background);
		color: var(--color-text);
	}

	.chips {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.chip {
		padding: 0.3rem 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 8%, white);
		border: 1.5px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
		border-radius: 100px;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
		white-space: nowrap;
	}

	.chip:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, white);
		border-color: var(--color-accent);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.field-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-muted);
	}

	textarea {
		font: inherit;
		font-size: 0.9375rem;
		resize: vertical;
		padding: 0.625rem 0.875rem;
		border: 1.5px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		transition: border-color 0.15s;
		min-height: 5rem;
	}

	textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	textarea::placeholder {
		color: var(--color-muted);
		opacity: 0.6;
	}

	textarea:disabled {
		opacity: 0.6;
	}

	.actions {
		display: flex;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.btn-apply {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.6rem 1.25rem;
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: none;
		border-radius: 10px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-apply:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.btn-apply:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.btn-undo {
		padding: 0.6rem 1.25rem;
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-background);
		border: 1.5px solid var(--color-border);
		border-radius: 10px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.btn-undo:hover:not(:disabled) {
		border-color: var(--color-muted);
		background: var(--color-surface-hover);
	}

	.btn-undo:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.spinner {
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid rgb(255 255 255 / 0.35);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
