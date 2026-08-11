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
	import { Trash2 } from '@lucide/svelte';
	import type { ProjectSessionRecord } from '$lib/api/contract';
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';

	interface Props {
		session: ProjectSessionRecord;
		forkedFromTitle: string | null;
		renaming: boolean;
		archiving: boolean;
		oncontinue: () => void;
		onrename: (title: string) => Promise<void>;
		ondelete: () => Promise<void>;
	}

	let { session, forkedFromTitle, renaming, archiving, oncontinue, onrename, ondelete }: Props =
		$props();

	// Same overridable-derived pattern as the project title on the parent page:
	// snaps back to the loaded session's title whenever that changes
	// underneath it (a fresh load, or this card's own rename response).
	let titleDraft = $derived(session.title);
	let renameError = $state<string | null>(null);
	let deleteError = $state<string | null>(null);
	let deleteConfirmOpen = $state(false);

	const displayTitle = $derived(
		session.title.trim() !== '' ? session.title : t('projects.detail.sessionUntitled')
	);
	const latest = $derived(session.generations[0]);

	function openModal(dialog: HTMLDialogElement): () => void {
		dialog.showModal();
		return () => {
			if (dialog.open) dialog.close();
		};
	}

	function formatDate(timestamp: number): string {
		return new Intl.DateTimeFormat(getLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(timestamp));
	}

	async function saveTitle(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const title = titleDraft.trim();
		if (!title || renaming || title === session.title) return;
		renameError = null;
		try {
			await onrename(title);
		} catch {
			renameError = t('projects.detail.sessionRenameFailed');
		}
	}

	function requestDelete(): void {
		deleteError = null;
		deleteConfirmOpen = true;
	}

	function cancelDelete(): void {
		deleteConfirmOpen = false;
	}

	async function confirmDelete(): Promise<void> {
		try {
			await ondelete();
			deleteConfirmOpen = false;
		} catch {
			deleteError = t('projects.detail.sessionDeleteFailed');
		}
	}
</script>

<li class="session-card">
	{#if latest}
		<span class="session-thumb">
			<img
				src={latest.url}
				alt={ti('projects.detail.sessionThumbnailAlt', { title: displayTitle })}
				loading="lazy"
			/>
		</span>
	{/if}
	<div class="session-body">
		<form class="session-rename-form" onsubmit={saveTitle}>
			<label class="visually-hidden" for={`session-title-${session.id}`}
				>{t('projects.detail.sessionRenameLabel')}</label
			>
			<input
				id={`session-title-${session.id}`}
				type="text"
				maxlength="200"
				placeholder={t('projects.detail.sessionUntitled')}
				bind:value={titleDraft}
				disabled={renaming}
			/>
			<button
				type="submit"
				class="session-rename-save"
				disabled={renaming || titleDraft.trim() === '' || titleDraft.trim() === session.title}
			>
				{renaming
					? t('projects.detail.sessionRenameSaving')
					: t('projects.detail.sessionRenameSave')}
			</button>
		</form>
		{#if renameError}
			<p class="status error" role="alert">{renameError}</p>
		{/if}

		{#if forkedFromTitle}
			<span class="session-forked"
				>{ti('projects.detail.sessionForkedFrom', { title: forkedFromTitle })}</span
			>
		{/if}
		<span class="session-updated"
			>{ti('projects.detail.sessionUpdatedAt', { date: formatDate(session.updatedAt) })}</span
		>

		<div class="session-actions">
			<button
				type="button"
				class="session-continue"
				aria-label={ti('projects.detail.sessionContinueAria', { title: displayTitle })}
				onclick={oncontinue}
			>
				{t('projects.detail.sessionContinue')}
			</button>
			<button
				type="button"
				class="session-delete"
				aria-label={ti('projects.detail.sessionDeleteAria', { title: displayTitle })}
				disabled={archiving}
				onclick={requestDelete}
			>
				<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
			</button>
		</div>
	</div>

	{#if deleteConfirmOpen}
		<dialog
			class="confirm-dialog"
			{@attach openModal}
			aria-labelledby={`session-delete-title-${session.id}`}
			aria-describedby={`session-delete-description-${session.id}`}
			oncancel={(event) => {
				event.preventDefault();
				cancelDelete();
			}}
		>
			<h3 id={`session-delete-title-${session.id}`}>
				{t('projects.detail.sessionDeleteConfirmTitle')}
			</h3>
			<p id={`session-delete-description-${session.id}`}>
				{t('projects.detail.sessionDeleteConfirmDescription')}
			</p>
			{#if deleteError}
				<p class="status error" role="alert">{deleteError}</p>
			{/if}
			<div class="confirm-actions">
				<button type="button" class="secondary-button" onclick={cancelDelete}>
					{t('projects.detail.sessionDeleteConfirmCancel')}
				</button>
				<button
					type="button"
					class="primary-danger-button"
					disabled={archiving}
					onclick={confirmDelete}
				>
					{t('projects.detail.sessionDeleteConfirmConfirm')}
				</button>
			</div>
		</dialog>
	{/if}
</li>

<style>
	.session-card {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
		overflow: hidden;
	}

	.session-thumb {
		display: block;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
	}

	.session-thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.session-body {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.75rem;
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

	.session-rename-form {
		display: flex;
		gap: 0.375rem;
	}

	.session-rename-form input {
		flex: 1;
		min-width: 0;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-weight: 650;
		font-size: 0.9375rem;
	}

	.session-rename-save {
		padding: 0.375rem 0.625rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.session-rename-save:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.status {
		margin: 0;
		font-size: 0.75rem;
	}

	.error {
		color: var(--color-danger);
	}

	.session-forked,
	.session-updated {
		color: var(--color-muted);
		font-size: 0.75rem;
	}

	.session-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.375rem;
	}

	.session-continue {
		padding: 0.5rem 0.875rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 650;
		cursor: pointer;
	}

	.session-delete {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.session-delete:hover {
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		color: var(--color-danger);
	}

	.session-delete:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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

	.primary-danger-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
