<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	const MAX_SIZE = 8 * 1024 * 1024;

	let uploading = $state(false);
	let error = $state<string | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let previewUrl = $state<string | null>(null);
	let dragOver = $state(false);

	function attachInput(node: HTMLInputElement): void {
		inputEl = node;
	}

	const imageUrl = $derived(request.image?.url ?? null);
	const hasImage = $derived(imageUrl !== null || previewUrl !== null);

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
			const formData = new FormData();
			formData.append('file', file);
			const response = await fetch('/api/uploads', { method: 'POST', body: formData });
			if (!response.ok) throw new Error('upload failed');
			const result = await response.json();
			request.setImage({
				url: result.url,
				mime: result.mime,
				size: result.size,
				dimensions: result.dimensions
			});
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
		dragOver = false;
		const file = event.dataTransfer?.files[0];
		if (file) void handleFile(file);
	}

	function onDragOver(event: DragEvent): void {
		event.preventDefault();
		dragOver = true;
	}

	function onDragLeave(): void {
		dragOver = false;
	}
</script>

<div
	class="upload"
	class:has-image={hasImage}
	class:drag-over={dragOver}
	class:has-error={error !== null}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	role="region"
	aria-label={t('upload.label')}
>
	{#if hasImage}
		<div class="image-wrapper">
			<img src={previewUrl ?? imageUrl ?? ''} alt={t('upload.label')} class="preview" />
			<div class="image-overlay">
				<button
					type="button"
					class="change-btn"
					onclick={() => inputEl?.click()}
					disabled={uploading}
				>
					{uploading ? t('upload.uploading') : t('upload.change')}
				</button>
			</div>
		</div>
	{:else}
		<button
			type="button"
			class="drop-zone"
			onclick={() => inputEl?.click()}
			disabled={uploading}
			aria-label={t('upload.button')}
		>
			{#if uploading}
				<span class="uploading-text">{t('upload.uploading')}</span>
			{:else}
				<svg
					class="upload-icon"
					width="32"
					height="32"
					viewBox="0 0 24 24"
					fill="none"
					aria-hidden="true"
				>
					<path
						d="M12 16V8M12 8L9 11M12 8L15 11"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
					<path
						d="M20 16.7428C21.2215 15.9808 22 14.5985 22 13C22 10.5147 19.9956 8.5 17.5 8.5C17.3557 8.5 17.2143 8.506 17.075 8.518C16.5554 6.22048 14.4981 4.5 12 4.5C9.01766 4.5 6.6 6.9 6.6 9.9C6.6 9.9483 6.60107 9.99645 6.60319 10.0445C4.55587 10.3177 3 12.0896 3 14.2C3 16.5196 4.89543 18.4 7.2 18.4H9"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<span class="drop-title">{t('upload.dropTitle')}</span>
				<span class="drop-subtitle">{t('upload.dropSubtitle')}</span>
			{/if}
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
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 200px;
		padding: 2rem 1.5rem;
		background: var(--color-surface);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-muted);
		font: inherit;
		cursor: pointer;
		text-align: center;
		transition:
			border-color 0.15s,
			background 0.15s,
			color 0.15s;
		width: 100%;
		box-sizing: border-box;
	}

	.drop-zone:hover:not(:disabled),
	.drag-over .drop-zone {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 4%, var(--color-surface));
		color: var(--color-text);
	}

	.has-error .drop-zone {
		border-color: var(--color-danger);
	}

	.drop-zone:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.upload-icon {
		color: var(--color-muted);
		flex-shrink: 0;
	}

	.drop-title {
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.drop-subtitle {
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.uploading-text {
		font-size: 0.9375rem;
		color: var(--color-muted);
	}

	.image-wrapper {
		position: relative;
		border-radius: var(--radius-lg);
		overflow: hidden;
		border: 1.5px solid var(--color-border);
	}

	.preview {
		width: 100%;
		max-height: 280px;
		object-fit: cover;
		display: block;
	}

	.image-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(0 0 0 / 0.35);
		opacity: 0;
		transition: opacity 0.2s;
	}

	.image-wrapper:hover .image-overlay {
		opacity: 1;
	}

	.change-btn {
		padding: 0.5rem 1.25rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: #fff;
		background: rgb(0 0 0 / 0.55);
		border: 1.5px solid rgb(255 255 255 / 0.4);
		border-radius: var(--radius);
		cursor: pointer;
		backdrop-filter: blur(4px);
		transition: background 0.15s;
	}

	.change-btn:hover:not(:disabled) {
		background: rgb(0 0 0 / 0.7);
	}

	.change-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.file-input {
		display: none;
	}

	.error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
