<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	const MAX_SIZE = 8 * 1024 * 1024;

	let uploading = $state(false);
	let error = $state<string | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let previewUrl = $state<string | null>(null);

	function attachInput(node: HTMLInputElement): void {
		inputEl = node;
	}

	const imageUrl = $derived(request.image?.url ?? null);

	async function handleFile(file: File): Promise<void> {
		error = null;
		if (!file.type.startsWith('image/')) {
			error = t('upload.errorType');
			return;
		}
		if (file.size > MAX_SIZE) {
			error = t('upload.errorSize');
			return;
		}
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(file);

		uploading = true;
		try {
			const response = await fetch('/api/uploads', { method: 'POST' });
			if (!response.ok) throw new Error('upload failed');
			const result = await response.json();
			request.setImage({ url: result.url, mime: result.mime, size: result.size, dimensions: result.dimensions });
		} catch {
			error = t('upload.errorType');
		} finally {
			uploading = false;
		}
	}

	function onInput(event: Event): void {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (file) void handleFile(file);
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		const file = event.dataTransfer?.files[0];
		if (file) void handleFile(file);
	}
</script>

<div
	class="upload"
	class:has-image={imageUrl !== null}
	ondragover={(e) => e.preventDefault()}
	ondrop={onDrop}
	role="region"
	aria-label={t('upload.label')}
>
	{#if imageUrl}
		<img src={previewUrl ?? imageUrl} alt={t('upload.label')} class="preview" />
		<button type="button" class="change-btn" onclick={() => inputEl?.click()} disabled={uploading}>
			{uploading ? t('upload.uploading') : t('upload.change')}
		</button>
	{:else}
		<button type="button" class="drop-zone" onclick={() => inputEl?.click()} disabled={uploading}>
			{uploading ? t('upload.uploading') : t('upload.dropHint')}
		</button>
	{/if}
	<input
		{@attach attachInput}
		type="file"
		accept="image/*"
		aria-label={t('upload.button')}
		class="file-input"
		oninput={onInput}
	/>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.upload {
		display: grid;
		gap: var(--space-1);
	}

	.drop-zone {
		min-height: 8rem;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3);
		background: var(--color-surface);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius);
		color: var(--color-muted);
		font: inherit;
		cursor: pointer;
		text-align: center;
	}

	.drop-zone:hover:not(:disabled) {
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.preview {
		width: 100%;
		max-height: 16rem;
		object-fit: cover;
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
	}

	.change-btn {
		justify-self: start;
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		cursor: pointer;
	}

	.file-input {
		display: none;
	}

	.error {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-danger);
	}
</style>
