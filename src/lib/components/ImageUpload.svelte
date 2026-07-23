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
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import type { UploadResult } from '$lib/api/contract';
	import { request, type ImageInput } from '$lib/state/request.svelte';

	const MAX_SIZE = 8 * 1024 * 1024;

	type UploadTarget = 'room' | 'styleReference' | 'objectReference' | 'textureReference';

	interface Props {
		target?: UploadTarget;
		label?: TranslationKey;
		requiredLabel?: TranslationKey;
		disabled?: boolean;
	}

	let {
		target = 'room',
		label = undefined,
		requiredLabel = undefined,
		disabled = false
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
						: 'upload.button')
	);
	const changeKey = $derived<TranslationKey>(
		target === 'styleReference'
			? 'styleTransfer.referenceChange'
			: target === 'objectReference'
				? 'objectReplacement.referenceChange'
				: target === 'textureReference'
					? 'textureReplacement.referenceChange'
					: 'upload.change'
	);
	const dropTitleKey = $derived<TranslationKey>(
		target === 'styleReference'
			? 'styleTransfer.referenceDropTitle'
			: target === 'objectReference'
				? 'objectReplacement.referenceDropTitle'
				: target === 'textureReference'
					? 'textureReplacement.referenceDropTitle'
					: 'upload.dropTitle'
	);
	const dropSubtitleKey = $derived<TranslationKey>(
		target === 'styleReference'
			? 'styleTransfer.referenceDropSubtitle'
			: target === 'objectReference'
				? 'objectReplacement.referenceDropSubtitle'
				: target === 'textureReference'
					? 'textureReplacement.referenceDropSubtitle'
					: 'upload.dropSubtitle'
	);
	const imageUrl = $derived(image?.url ?? null);
	const hasImage = $derived(imageUrl !== null || previewUrl !== null);
	const controlLabel = $derived(
		requiredLabel ? `${t(ariaLabelKey)} — ${t(requiredLabel)}` : t(ariaLabelKey)
	);
	const dropButtonLabel = $derived(requiredLabel ? controlLabel : t(buttonLabelKey));

	function setUploadedImage(next: ImageInput): void {
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
		request.setImage(next);
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
		if (disabled) return;
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
			if (!response.ok) {
				error = await responseErrorMessage(response);
				return;
			}
			const result = (await response.json()) as UploadResult;
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = null;
			setUploadedImage({
				url: result.url,
				mime: result.mime,
				size: result.size,
				dimensions: result.dimensions
			});
		} catch {
			error = t('upload.errorUpload');
		} finally {
			uploading = false;
		}
	}

	async function importRemoteUrl(): Promise<void> {
		if (disabled) return;
		const value = remoteUrl.trim();
		error = null;
		if (!isHttpsUrl(value)) {
			error = t('upload.errorUrl');
			return;
		}

		uploading = true;
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
			const result = (await response.json()) as UploadResult;
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = null;
			remoteUrl = '';
			setUploadedImage({
				url: result.url,
				mime: result.mime,
				size: result.size,
				dimensions: result.dimensions
			});
		} catch {
			error = t('upload.errorRemote');
		} finally {
			uploading = false;
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
				<button
					type="button"
					class="change-btn"
					onclick={() => inputEl?.click()}
					disabled={uploading || disabled}
				>
					{uploading ? t('upload.uploading') : t(changeKey)}
				</button>
			</div>
		</div>
	{:else}
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
		color: var(--color-muted-strong);
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
		color: var(--color-muted-strong);
	}

	.uploading-text {
		font-size: 0.9375rem;
		color: var(--color-muted-strong);
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

	.image-wrapper:hover .image-overlay,
	.image-wrapper:focus-within .image-overlay {
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

	.url-form {
		display: flex;
		gap: 0.5rem;
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
</style>
