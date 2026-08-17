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
	import { X } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { t } from '$lib/i18n/index.svelte';
	import { projectShare } from '$lib/state/project-share.svelte';
	import { logBoundaryError, openModal } from '$lib/utils';

	interface Props {
		projectId: string;
		open: boolean;
		onClose: () => void;
	}

	let { projectId, open, onClose }: Props = $props();

	let shareError = $state<string | null>(null);
	let shareCopied = $state(false);
	let revokeConfirmOpen = $state(false);
	let revokeError = $state<string | null>(null);

	// The dialog stays mounted for the component's whole lifetime (see the
	// `open` prop / effect below), same as ScenesDrawer — only its `open`
	// prop's false→true transition should trigger a fresh fetch, not every
	// reactive run while it's already open.
	let wasOpen = false;
	let dialogEl = $state<HTMLDialogElement | null>(null);

	function attachDialog(node: HTMLDialogElement): () => void {
		dialogEl = node;
		return () => {
			dialogEl = null;
		};
	}

	$effect(() => {
		if (!dialogEl) return;
		if (open) {
			if (!dialogEl.open) dialogEl.showModal();
			if (!wasOpen) {
				shareError = null;
				shareCopied = false;
				void projectShare.load(projectId);
			}
		} else if (dialogEl.open) {
			dialogEl.close();
		}
		wasOpen = open;
	});

	function closeDialog(): void {
		onClose();
	}

	function handleDialogClose(): void {
		onClose();
	}

	function handleDialogCancel(event: Event): void {
		event.preventDefault();
		closeDialog();
	}

	async function createShareLink(): Promise<void> {
		shareError = null;
		shareCopied = false;
		try {
			await projectShare.issueShare(projectId);
		} catch {
			shareError = t('projects.detail.shareCreateFailed');
		}
	}

	function requestRevokeShare(): void {
		revokeError = null;
		revokeConfirmOpen = true;
	}

	function cancelRevokeShare(): void {
		revokeConfirmOpen = false;
	}

	async function confirmRevokeShare(): Promise<void> {
		try {
			await projectShare.revokeShare(projectId);
			revokeConfirmOpen = false;
		} catch {
			revokeError = t('projects.detail.shareRevokeFailed');
		}
	}

	function shareUrl(token: string): string {
		return `${page.url.origin}${resolve('/share/[token]', { token })}`;
	}

	async function copyShareLink(token: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(shareUrl(token));
			shareCopied = true;
		} catch (error) {
			shareCopied = false;
			shareError = t('projects.detail.shareCopyFailed');
			logBoundaryError('shareProjectDialog.copyShareLink', error);
		}
	}
</script>

<dialog
	class="share-dialog"
	{@attach attachDialog}
	aria-labelledby="share-dialog-title"
	oncancel={handleDialogCancel}
	onclose={handleDialogClose}
>
	<header class="dialog-header">
		<h2 id="share-dialog-title">{t('projects.detail.shareTitle')}</h2>
		<button
			type="button"
			class="close-button"
			aria-label={t('projects.detail.shareDialogClose')}
			title={t('projects.detail.shareDialogClose')}
			onclick={closeDialog}
		>
			<X size={20} strokeWidth={1.8} aria-hidden="true" />
		</button>
	</header>

	<p class="status">{t('projects.detail.shareDescription')}</p>

	<div class="share-status" aria-live="polite">
		{#if projectShare.status === 'loading'}
			<p class="status">{t('projects.detail.shareLoading')}</p>
		{:else if projectShare.token}
			{@const token = projectShare.token}
			<div class="share-link">
				<label class="visually-hidden" for="share-dialog-link-url"
					>{t('projects.detail.shareLinkLabel')}</label
				>
				<input id="share-dialog-link-url" type="text" readonly value={shareUrl(token)} />
				<button type="button" onclick={() => copyShareLink(token)}>
					{shareCopied ? t('projects.detail.shareCopied') : t('projects.detail.shareCopy')}
				</button>
				<button
					type="button"
					class="danger"
					onclick={requestRevokeShare}
					disabled={projectShare.status === 'revoking'}
				>
					{projectShare.status === 'revoking'
						? t('projects.detail.shareRevoking')
						: t('projects.detail.shareRevoke')}
				</button>
			</div>
			<p class="status">{t('projects.detail.shareActiveHint')}</p>
		{:else if projectShare.status === 'active'}
			<p class="status">{t('projects.detail.shareActiveUnknown')}</p>
			<div class="share-link">
				<button type="button" onclick={createShareLink}>
					{t('projects.detail.shareCreateNew')}
				</button>
				<button type="button" class="danger" onclick={requestRevokeShare}>
					{t('projects.detail.shareRevoke')}
				</button>
			</div>
		{:else}
			<button type="button" onclick={createShareLink} disabled={projectShare.status === 'issuing'}>
				{projectShare.status === 'issuing'
					? t('projects.detail.shareCreating')
					: t('projects.detail.shareCreate')}
			</button>
		{/if}
	</div>
	{#if shareError}
		<p class="status error" role="alert">{shareError}</p>
	{/if}
</dialog>

{#if revokeConfirmOpen}
	<dialog
		class="confirm-dialog"
		{@attach openModal}
		aria-labelledby="revoke-share-confirm-title"
		aria-describedby="revoke-share-confirm-description"
		oncancel={(event) => {
			event.preventDefault();
			cancelRevokeShare();
		}}
	>
		<h3 id="revoke-share-confirm-title">{t('projects.detail.shareRevokeConfirmTitle')}</h3>
		<p id="revoke-share-confirm-description">
			{t('projects.detail.shareRevokeConfirmDescription')}
		</p>
		{#if revokeError}
			<p class="status error" role="alert">{revokeError}</p>
		{/if}
		<div class="confirm-actions">
			<button type="button" class="secondary-button" onclick={cancelRevokeShare}>
				{t('projects.detail.shareRevokeConfirmCancel')}
			</button>
			<button
				type="button"
				class="primary-danger-button"
				disabled={projectShare.status === 'revoking'}
				onclick={confirmRevokeShare}
			>
				{t('projects.detail.shareRevokeConfirmConfirm')}
			</button>
		</div>
	</dialog>
{/if}

<style>
	/* The dialog stays mounted for this component's whole lifetime (see the
	   `open` prop / effect in the script) rather than being toggled with an
	   {#if} — so, unlike +page.svelte's own .confirm-dialog, visibility here
	   must stay keyed off the native [open] attribute rather than an
	   unconditional `display`, or the dialog would render (and intercept
	   clicks) even while closed. Matches how ScenesDrawer's persistent
	   .drawer leaves `display` alone for the same reason. */
	.share-dialog[open] {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.share-dialog {
		width: min(100% - 2rem, 28rem);
		max-width: none;
		margin: auto;
		padding: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
	}

	.share-dialog::backdrop {
		background: rgb(29 29 31 / 0.32);
		backdrop-filter: blur(4px);
	}

	.dialog-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.dialog-header h2 {
		margin: 0;
		color: var(--color-text);
		font-size: 1.125rem;
		font-weight: 700;
	}

	.close-button {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-background);
		color: var(--color-text);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.close-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent);
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

	.status {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.875rem;
	}

	.error {
		color: var(--color-danger);
	}

	.share-status {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* .share-link (input + action buttons) should still stretch to the full
	   row width via the flex column's default stretch — only a lone button
	   with no input alongside it (the "no share yet" state) needs to shrink
	   back to its own content width instead of filling the row. */
	.share-status > button {
		align-self: flex-start;
	}

	.share-link {
		display: flex;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.share-link input {
		flex: 1 1 12rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
	}

	button {
		padding: 0.625rem 1.125rem;
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	button.danger {
		background: var(--color-danger);
	}

	.confirm-dialog {
		width: min(100% - 2rem, 25rem);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: none;
		margin: auto;
		padding: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
	}

	.confirm-dialog::backdrop {
		background: rgb(29 29 31 / 0.32);
		backdrop-filter: blur(4px);
	}

	.confirm-dialog h3 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 650;
	}

	.confirm-dialog p {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.875rem;
		line-height: 1.4;
	}

	.confirm-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.secondary-button,
	.primary-danger-button {
		min-height: 2.5rem;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.secondary-button {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.secondary-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.primary-danger-button {
		border: 1px solid var(--color-danger);
		background: var(--color-danger);
		color: white;
	}

	.primary-danger-button:hover {
		background: color-mix(in srgb, var(--color-danger) 86%, black);
	}

	.primary-danger-button:disabled,
	.secondary-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
