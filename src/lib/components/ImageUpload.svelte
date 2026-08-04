<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate written
agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<script lang="ts">
	import { uploadResultSchema } from '$lib/api/contract';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import {
		request,
		type ImageInput,
		type TextureMaskUploadOperation
	} from '$lib/state/request.svelte';

	const MAX_SIZE = 8 * 1024 * 1024;

	type UploadTarget =
		| 'room'
		| 'styleReference'
		| 'objectReference'
		| 'textureReference'
		| 'textureMask';

	interface Props {
		target?: UploadTarget;
		label?: TranslationKey;
		requiredLabel?: TranslationKey;
		disabled?: boolean;
		compact?: boolean;
		onUploadingChange?: (uploading: boolean) => void;
	}

	let {
		target = 'room',
		label = undefined,
		requiredLabel = undefined,
		disabled = false,
		compact = false,
		onUploadingChange = undefined
	}: Props = $props();

	let uploading = $state(false);
	let error = $state<string | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let previewUrl = $state<string | null>(null);
	let dragOver = $state(false);
	let remoteUrl = $state('');

	function attachInput(node: HTMLInputElement): void {
		inputEl = node;
	}

	const image = $derived(
		target === 'styleReference'
			? request.styleReferenceImage
			: target === 'objectReference'
				? request.objectReferenceImage
				: target === 'textureReference'
					? request.textureReferenceImage
					: target === 'textureMask'
						? request.textureMaskMatchesSource()
							? request.textureMaskImage
							: undefined
						: request.image
	);
	const ariaLabelKey = $derived<TranslationKey>(
		label ??
			(target === 'styleReference'
				? 'styleTransfer.referenceImage'
				: target === 'objectReference'
					? 'objectReplacement.referenceImage'
					: target === 'textureReference'
						? 'textureReplacement.referenceImage'
						: target === 'textureMask'
							? 'textureReplacement.maskImage'
							: 'upload.label')
	);
	const buttonLabelKey = $derived<TranslationKey>(
		label ??
			(target === 'styleReference'
				? 'styleTransfer.referenceImage'
				: target === 'objectReference'
					? 'objectReplacement.referenceImage'
					: target === 'textureReference'
						? 'textureReplacement.referenceImage'
						: target === 'textureMask'
							? 'textureReplacement.maskImage'
							: 'upload.button')
	);
	const changeKey = $derived<TranslationKey>(
		target === 'styleReference'
			? 'styleTransfer.referenceChange'
			: target === 'objectReference'
				? 'objectReplacement.referenceChange'
				: target === 'textureReference'
					? 'textureReplacement.referenceChange'
					: target === 'textureMask'
						? 'textureReplacement.maskChange'
						: 'upload.change'
	);
	const dropTitleKey = $derived<TranslationKey>(
		target === 'styleReference'
			? 'styleTransfer.referenceDropTitle'
			: target === 'objectReference'
				? 'objectReplacement.referenceDropTitle'
				: target === 'textureReference'
					? 'textureReplacement.referenceDropTitle'
					: target === 'textureMask'
						? 'textureReplacement.maskDropTitle'
						: 'upload.dropTitle'
	);
	const dropSubtitleKey = $derived<TranslationKey>(
		target === 'styleReference'
			? 'styleTransfer.referenceDropSubtitle'
			: target === 'objectReference'
				? 'objectReplacement.referenceDropSubtitle'
				: target === 'textureReference'
					? 'textureReplacement.referenceDropSubtitle'
					: target === 'textureMask'
						? 'textureReplacement.maskDropSubtitle'
						: 'upload.dropSubtitle'
	);
	const imageUrl = $derived(image?.url ?? null);
	const hasImage = $derived(imageUrl !== null || previewUrl !== null);
	const controlLabel = $derived(
		requiredLabel ? `${t(ariaLabelKey)} — ${t(requiredLabel)}` : t(ariaLabelKey)
	);
	const dropButtonLabel = $derived(requiredLabel ? controlLabel : t(buttonLabelKey));

	function setUploadedImage(
		next: ImageInput,
		textureMaskUpload?: TextureMaskUploadOperation
	): void {
		if (target === 'styleReference') {
			request.setStyleReferenceImage(next);
			return;
		}
		if (target === 'objectReference') {
			request.setObjectReferenceImage(next);
			return;
		}
		if (target === 'textureReference') {
			request.setTextureReferenceImage(next);
			return;
		}
		if (target === 'textureMask') {
			if (!textureMaskUpload) {
				error = t('textureReplacement.maskEditor.saveFailed');
				return;
			}
			if (!request.commitTextureMaskUpload(next, textureMaskUpload)) {
				error = t('textureReplacement.maskEditor.saveFailed');
			}
			return;
		}
		request.setImage(next);
	}

	function clearUploadedImage(): void {
		if (disabled || uploading) return;
		if (target === 'styleReference') {
			request.setStyleReferenceImage(undefined);
		} else if (target === 'objectReference') {
			request.setObjectReferenceImage(undefined);
		} else if (target === 'textureReference') {
			request.setTextureReferenceImage(undefined);
		} else if (target === 'textureMask') {
			request.setTextureMaskImage(undefined);
		} else {
			request.setImage(undefined);
		}
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
		if (inputEl) inputEl.value = '';
		remoteUrl = '';
		error = null;
		dragOver = false;
	}

	function setUploading(value: boolean): void {
		uploading = value;
		onUploadingChange?.(value);
	}

	function errorMessageForCode(code: string | null): string {
		switch (code) {
			case 'invalid_url':
				return t('upload.errorUrl');
			case 'unsupported_image_type':
				return t('upload.errorType');
			case 'image_too_large':
				return t('upload.errorSize');
			case 'remote_fetch_failed':
				return t('upload.errorRemote');
			default:
				return t('upload.errorUpload');
		}
	}

	async function responseErrorMessage(response: Response): Promise<string> {
		const body: unknown = await response.json().catch(() => null);
		if (
			typeof body === 'object' &&
			body !== null &&
			'error' in body &&
			typeof body.error === 'object' &&
			body.error !== null &&
			'code' in body.error &&
			typeof body.error.code === 'string'
		) {
			return errorMessageForCode(body.error.code);
		}
		return t('upload.errorUpload');
	}

	function isHttpsUrl(value: string): boolean {
		try {
			return new URL(value).protocol === 'https:';
		} catch {
			return false;
		}
	}

	async function handleFile(file: File): Promise<void> {
		if (disabled || uploading) return;
		error = null;
		if (!file.type.startsWith('image/')) {
			error = t('upload.errorType');
			return;
		}
		if (file.size > MAX_SIZE) {
			error = t('upload.errorSize');
			return;
		}
		const textureMaskUpload =
			target === 'textureMask' ? (request.beginTextureMaskUpload() ?? undefined) : undefined;
		if (target === 'textureMask' && !textureMaskUpload) {
			error = t('textureReplacement.maskEditor.sourceRequired');
			return;
		}
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(file);

		setUploading(true);
		try {
			const formData = new FormData();
			formData.append('file', file);
			const response = await fetch('/api/uploads', { method: 'POST', body: formData });
			if (!response.ok) {
				error = await responseErrorMessage(response);
				return;
			}
			const parsed = uploadResultSchema.safeParse(await response.json());
			if (!parsed.success) {
				error = t('upload.errorUpload');
				return;
			}
			const result = parsed.data;
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = null;
			setUploadedImage(
				{
					url: result.url,
					mime: result.mime,
					size: result.size,
					dimensions: result.dimensions
				},
				textureMaskUpload
			);
		} catch {
			error = t('upload.errorUpload');
		} finally {
			if (textureMaskUpload) request.finishTextureMaskUpload(textureMaskUpload);
			setUploading(false);
		}
	}

	async function importRemoteUrl(): Promise<void> {
		if (disabled || uploading) return;
		const value = remoteUrl.trim();
		error = null;
		if (!isHttpsUrl(value)) {
			error = t('upload.errorUrl');
			return;
		}
		const textureMaskUpload =
			target === 'textureMask' ? (request.beginTextureMaskUpload() ?? undefined) : undefined;
		if (target === 'textureMask' && !textureMaskUpload) {
			error = t('textureReplacement.maskEditor.sourceRequired');
			return;
		}

		setUploading(true);
		try {
			const response = await fetch('/api/uploads', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url: value })
			});
			if (!response.ok) {
				error = await responseErrorMessage(response);
				return;
			}
			const parsed = uploadResultSchema.safeParse(await response.json());
			if (!parsed.success) {
				error = t('upload.errorUpload');
				return;
			}
			const result = parsed.data;
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = null;
			remoteUrl = '';
			setUploadedImage(
				{
					url: result.url,
					mime: result.mime,
					size: result.size,
					dimensions: result.dimensions
				},
				textureMaskUpload
			);
		} catch {
			error = t('upload.errorRemote');
		} finally {
			if (textureMaskUpload) request.finishTextureMaskUpload(textureMaskUpload);
			setUploading(false);
		}
	}

	function onRemoteUrlSubmit(event: SubmitEvent): void {
		event.preventDefault();
		void importRemoteUrl();
	}

	function onInput(event: Event): void {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (file) void handleFile(file);
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		dragOver = false;
		if (disabled) return;
		const file = event.dataTransfer?.files[0];
		if (file) void handleFile(file);
	}

	function onDragOver(event: DragEvent): void {
		event.preventDefault();
		if (disabled) return;
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
	class:compact
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	role="region"
	aria-label={controlLabel}
>
	{#if hasImage}
		<div class="image-wrapper">
			<img src={previewUrl ?? imageUrl ?? ''} alt={t(ariaLabelKey)} class="preview" />
			<div class="image-overlay">
				<div class="image-actions">
					<button
						type="button"
						class="image-action change-btn"
						onclick={() => inputEl?.click()}
						disabled={uploading || disabled}
						aria-label={t(changeKey)}
					>
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path
								d="M13.5 6.5L17.5 10.5M4 20L8.2 19.1L19.4 7.9C20.2 7.1 20.2 5.9 19.4 5.1L18.9 4.6C18.1 3.8 16.9 3.8 16.1 4.6L4.9 15.8L4 20Z"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						<span class="action-label">{uploading ? t('upload.uploading') : t(changeKey)}</span>
					</button>
					<button
						type="button"
						class="image-action remove-btn"
						onclick={clearUploadedImage}
						disabled={uploading || disabled}
						aria-label={t('upload.remove')}
					>
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path
								d="M8 9V18M12 9V18M16 9V18M5 6H19M9 6V4H15V6M7 6L8 21H16L17 6"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						<span class="action-label">{t('upload.remove')}</span>
					</button>
				</div>
			</div>
		</div>
	{:else}
		<div class="empty-state">
			<button
				type="button"
				class="drop-zone"
				onclick={() => inputEl?.click()}
				disabled={uploading || disabled}
				aria-label={dropButtonLabel}
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
					<span class="drop-title">{t(dropTitleKey)}</span>
					<span class="drop-subtitle">{t(dropSubtitleKey)}</span>
				{/if}
			</button>
			<form class="url-form" novalidate onsubmit={onRemoteUrlSubmit}>
				<label class="url-label">
					<span>{t('upload.urlLabel')}</span>
					<input
						type="url"
						bind:value={remoteUrl}
						aria-label={`${controlLabel}: ${t('upload.urlLabel')}`}
						placeholder={t('upload.urlPlaceholder')}
						autocomplete="url"
						inputmode="url"
						disabled={uploading || disabled}
						oninput={() => (error = null)}
					/>
				</label>
				<button
					type="submit"
					aria-label={`${t('upload.import')}: ${controlLabel}`}
					disabled={uploading || disabled || remoteUrl.trim().length === 0}
				>
					{uploading ? t('upload.importing') : t('upload.import')}
				</button>
			</form>
		</div>
	{/if}
	<input
		{@attach attachInput}
		type="file"
		accept="image/*"
		{disabled}
		required={requiredLabel !== undefined}
		aria-label={controlLabel}
		class="file-input"
		oninput={onInput}
	/>
	<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
		{uploading ? t('upload.uploading') : ''}
	</div>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.upload {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.empty-state {
		overflow: hidden;
		background: var(--color-surface);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.drag-over .empty-state {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.has-error .empty-state {
		border-color: var(--color-danger);
	}

	.drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 200px;
		padding: 2rem 1.5rem;
		background: transparent;
		border: 0;
		color: var(--color-muted-strong);
		font: inherit;
		cursor: pointer;
		text-align: center;
		transition:
			background 0.15s,
			color 0.15s;
		width: 100%;
		box-sizing: border-box;
	}

	.drop-zone:hover:not(:disabled),
	.drag-over .drop-zone {
		background: color-mix(in srgb, var(--color-accent) 4%, var(--color-surface));
		color: var(--color-text);
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
		color: var(--color-muted-strong);
	}

	.uploading-text {
		font-size: 0.9375rem;
		color: var(--color-muted-strong);
	}

	.image-wrapper {
		position: relative;
		aspect-ratio: 16 / 9;
		min-width: 12rem;
		min-height: 9rem;
		max-width: 100%;
		border-radius: var(--radius-lg);
		overflow: hidden;
		border: 1.5px solid var(--color-border);
		background: var(--color-background);
		resize: both;
	}

	.preview {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.image-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 0.75rem;
		background: linear-gradient(to top, rgb(0 0 0 / 0.5), transparent 55%);
		opacity: 1;
		transition: opacity 0.2s;
	}

	.image-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		max-width: 100%;
	}

	.image-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		min-height: 2.5rem;
		padding: 0.5rem 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-surface) 94%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
		border-radius: var(--radius);
		cursor: pointer;
		backdrop-filter: blur(4px);
		box-shadow: var(--shadow-sm);
		transition:
			background 0.15s,
			color 0.15s;
	}

	.image-action svg {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
	}

	.image-action:hover:not(:disabled) {
		background: var(--color-surface);
	}

	.remove-btn {
		color: var(--color-danger);
	}

	.remove-btn:hover:not(:disabled) {
		background: var(--color-danger-bg);
	}

	.image-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.file-input {
		display: none;
	}

	.url-form {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		border-top: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-background) 45%, var(--color-surface));
	}

	.url-label {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-muted-strong);
	}

	.url-label input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--color-muted-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
	}

	.url-form button {
		align-self: end;
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
		background: var(--color-accent);
		color: #fff;
		font: inherit;
		cursor: pointer;
	}

	.url-form button:disabled,
	.url-label input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.compact .empty-state {
		max-width: 22rem;
	}

	.compact .drop-zone {
		min-height: 7rem;
		padding: 0.75rem;
		gap: 0.25rem;
	}

	.compact .upload-icon {
		width: 18px;
		height: 18px;
	}

	.compact .drop-title {
		font-size: 0.6875rem;
	}

	.compact .drop-subtitle,
	.compact .uploading-text {
		display: none;
	}

	.compact .image-wrapper {
		width: 100%;
		aspect-ratio: 16 / 9;
		max-width: 22rem;
		min-width: 0;
		min-height: 0;
		resize: none;
	}

	.compact .image-overlay {
		padding: 0.5rem;
	}

	.compact .image-actions {
		gap: 0.375rem;
	}

	.compact .image-action {
		width: 2.25rem;
		min-height: 2.25rem;
		padding: 0.375rem;
	}

	.compact .action-label {
		display: none;
	}

	.compact .url-form {
		flex-direction: column;
	}

	.compact .url-form button {
		align-self: stretch;
	}

	@media (hover: hover) and (pointer: fine) {
		.image-overlay {
			opacity: 0;
		}

		.image-wrapper:hover .image-overlay,
		.image-wrapper:focus-within .image-overlay {
			opacity: 1;
		}
	}

	@media (max-width: 36rem) {
		.url-form {
			flex-direction: column;
		}

		.url-form button {
			align-self: stretch;
		}
	}
</style>
