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
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ProjectSessionRecord } from '$lib/api/contract';
	import ProjectSessionCard from '$lib/components/ProjectSessionCard.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { projectDetail } from '$lib/state/project-detail.svelte';
	import { request } from '$lib/state/request.svelte';
	import { buildShareUrl } from '$lib/state/url-state';
	import { workspaceTabs } from '$lib/state/workspace-tabs.svelte';
	import { logBoundaryError } from '$lib/utils';

	const projectId = $derived(page.params.id);

	// Overridable derived (Svelte 5.25+ "optimistic UI" pattern): reassigning
	// titleDraft as the user types locally overrides it, but it snaps back to
	// the loaded project's title whenever that changes underneath it (a fresh
	// load, or the rename response itself).
	let titleDraft = $derived(projectDetail.project?.title ?? '');
	let renameError = $state<string | null>(null);
	let newSessionError = $state<string | null>(null);
	let shareError = $state<string | null>(null);
	let shareCopied = $state(false);
	let deleteProjectConfirmOpen = $state(false);
	let deleteProjectError = $state<string | null>(null);
	let revokeConfirmOpen = $state(false);
	let revokeError = $state<string | null>(null);

	$effect(() => {
		void projectDetail.load(projectId);
		return () => projectDetail.clear();
	});

	function openModal(dialog: HTMLDialogElement): () => void {
		dialog.showModal();
		return () => {
			if (dialog.open) dialog.close();
		};
	}

	function sessionTitle(session: ProjectSessionRecord): string {
		return session.title.trim() !== '' ? session.title : t('projects.detail.sessionUntitled');
	}

	function parentTitle(session: ProjectSessionRecord): string | null {
		if (!session.parentSessionId || !projectDetail.project) return null;
		const parent = projectDetail.project.sessions.find((s) => s.id === session.parentSessionId);
		return parent ? sessionTitle(parent) : null;
	}

	async function saveTitle(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const title = titleDraft.trim();
		if (!title || projectDetail.renaming) return;
		renameError = null;
		try {
			await projectDetail.rename(title);
		} catch {
			renameError = t('projects.detail.renameFailed');
		}
	}

	async function newSession(): Promise<void> {
		if (projectDetail.creatingSession) return;
		newSessionError = null;
		try {
			await projectDetail.createSession();
		} catch {
			newSessionError = t('projects.detail.newSessionFailed');
		}
	}

	function continueSession(session: ProjectSessionRecord): void {
		const project = projectDetail.project;
		if (!project) return;
		const latest = session.generations[0];
		workspaceTabs.openProject(project.id, project.title, (state) => {
			state.setCurrentRender(undefined);
			state.setProjectSession(project.id, session.id);
			state.setStyleSourceMode('room-photo');
			state.setObjectReplacementSourceMode('room-photo');
			state.setTextureReplacementSourceMode('room-photo');
			state.setTextureMaskImage(undefined);
			state.setActiveObjectReplacementJobId(undefined);
			state.setActiveTextureReplacementJobId(undefined);
			state.setStatus('idle');
			if (latest) state.setImage({ url: latest.url });
		});
		goto(buildShareUrl('render', request, { view: 'chat' }), { replaceState: false }).catch(
			(error: unknown) => logBoundaryError('projectDetailPage.continueSession', error)
		);
	}

	function requestDeleteProject(): void {
		deleteProjectError = null;
		deleteProjectConfirmOpen = true;
	}

	function cancelDeleteProject(): void {
		deleteProjectConfirmOpen = false;
	}

	async function confirmDeleteProject(): Promise<void> {
		try {
			await projectDetail.archiveProject();
			await goto(resolve('/projects', {}));
		} catch {
			deleteProjectError = t('projects.detail.deleteProjectFailed');
		}
	}

	async function createShareLink(): Promise<void> {
		shareError = null;
		shareCopied = false;
		try {
			await projectDetail.issueShare();
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
			await projectDetail.revokeShare();
			revokeConfirmOpen = false;
		} catch {
			revokeError = t('projects.detail.shareRevokeFailed');
		}
	}

	function shareUrl(token: string): string {
		return `${page.url.origin}${resolve('/share/[token]', { token })}`;
	}

	async function copyShareLink(token: string): Promise<void> {
		await navigator.clipboard.writeText(shareUrl(token));
		shareCopied = true;
	}
</script>

<svelte:head>
	<title>{projectDetail.project?.title ?? t('projects.title')}</title>
</svelte:head>

<main class="project-page" aria-labelledby="project-title">
	<a class="back-link" href={resolve('/projects', {})}>{t('projects.detail.back')}</a>

	{#if projectDetail.status === 'loading'}
		<p class="status">{t('projects.detail.loading')}</p>
	{:else if projectDetail.status === 'not-found'}
		<p class="status error" role="alert">{t('projects.detail.notFound')}</p>
	{:else if projectDetail.status === 'error'}
		<p class="status error" role="alert">{t('projects.detail.failed')}</p>
	{:else if projectDetail.project}
		{@const project = projectDetail.project}
		<section class="project-shell">
			<header class="project-header">
				<h1 id="project-title" class="visually-hidden">{project.title}</h1>
				<div class="header-row">
					<form class="rename-form" onsubmit={saveTitle}>
						<label class="visually-hidden" for="project-title-input"
							>{t('projects.detail.renameLabel')}</label
						>
						<input
							id="project-title-input"
							type="text"
							maxlength="200"
							bind:value={titleDraft}
							disabled={projectDetail.renaming}
						/>
						<button
							type="submit"
							disabled={projectDetail.renaming ||
								titleDraft.trim() === '' ||
								titleDraft.trim() === project.title}
						>
							{projectDetail.renaming
								? t('projects.detail.renaming')
								: t('projects.detail.renameSave')}
						</button>
					</form>
					<button
						type="button"
						class="danger"
						disabled={projectDetail.archivingProject}
						onclick={requestDeleteProject}
					>
						{t('projects.detail.deleteProject')}
					</button>
				</div>
				{#if renameError}
					<p class="status error" role="alert">{renameError}</p>
				{/if}
			</header>

			<section class="sessions-section" aria-labelledby="sessions-title">
				<div class="section-heading">
					<h2 id="sessions-title">{t('projects.detail.sessionsTitle')}</h2>
					<button type="button" onclick={newSession} disabled={projectDetail.creatingSession}>
						{projectDetail.creatingSession
							? t('projects.detail.creatingSession')
							: t('projects.detail.newSession')}
					</button>
				</div>
				{#if newSessionError}
					<p class="status error" role="alert">{newSessionError}</p>
				{/if}

				{#if project.sessions.length === 0}
					<p class="status">{t('projects.detail.sessionsEmpty')}</p>
				{:else}
					<ul class="sessions-grid">
						{#each project.sessions as session (session.id)}
							<ProjectSessionCard
								{session}
								forkedFromTitle={parentTitle(session)}
								renaming={projectDetail.renamingSessionId === session.id}
								archiving={projectDetail.archivingSessionId === session.id}
								oncontinue={() => continueSession(session)}
								onrename={(title) => projectDetail.renameSession(session.id, title)}
								ondelete={() => projectDetail.archiveSession(session.id)}
							/>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="share-section" aria-labelledby="share-title">
				<div class="section-heading">
					<h2 id="share-title">{t('projects.detail.shareTitle')}</h2>
				</div>
				<p class="status">{t('projects.detail.shareDescription')}</p>

				<div class="share-status" aria-live="polite">
					{#if projectDetail.shareToken}
						{@const token = projectDetail.shareToken}
						<div class="share-link">
							<label class="visually-hidden" for="share-link-url"
								>{t('projects.detail.shareLinkLabel')}</label
							>
							<input id="share-link-url" type="text" readonly value={shareUrl(token)} />
							<button type="button" onclick={() => copyShareLink(token)}>
								{shareCopied ? t('projects.detail.shareCopied') : t('projects.detail.shareCopy')}
							</button>
							<button
								type="button"
								class="danger"
								onclick={requestRevokeShare}
								disabled={projectDetail.shareStatus === 'revoking'}
							>
								{projectDetail.shareStatus === 'revoking'
									? t('projects.detail.shareRevoking')
									: t('projects.detail.shareRevoke')}
							</button>
						</div>
						<p class="status">{t('projects.detail.shareActiveHint')}</p>
					{:else if projectDetail.shareStatus === 'active'}
						<p class="status">{t('projects.detail.shareActiveUnknown')}</p>
						<div class="share-link">
							<button
								type="button"
								onclick={createShareLink}
								disabled={projectDetail.shareStatus !== 'active'}
							>
								{t('projects.detail.shareCreateNew')}
							</button>
							<button type="button" class="danger" onclick={requestRevokeShare}>
								{t('projects.detail.shareRevoke')}
							</button>
						</div>
					{:else}
						<button
							type="button"
							onclick={createShareLink}
							disabled={projectDetail.shareStatus === 'issuing'}
						>
							{projectDetail.shareStatus === 'issuing'
								? t('projects.detail.shareCreating')
								: t('projects.detail.shareCreate')}
						</button>
					{/if}
				</div>
				{#if shareError}
					<p class="status error" role="alert">{shareError}</p>
				{/if}
			</section>
		</section>

		{#if deleteProjectConfirmOpen}
			<dialog
				class="confirm-dialog"
				{@attach openModal}
				aria-labelledby="delete-project-confirm-title"
				aria-describedby="delete-project-confirm-description"
				oncancel={(event) => {
					event.preventDefault();
					cancelDeleteProject();
				}}
			>
				<h3 id="delete-project-confirm-title">{t('projects.detail.deleteProjectConfirmTitle')}</h3>
				<p id="delete-project-confirm-description">
					{t('projects.detail.deleteProjectConfirmDescription')}
				</p>
				{#if deleteProjectError}
					<p class="status error" role="alert">{deleteProjectError}</p>
				{/if}
				<div class="confirm-actions">
					<button type="button" class="secondary-button" onclick={cancelDeleteProject}>
						{t('projects.detail.deleteProjectConfirmCancel')}
					</button>
					<button
						type="button"
						class="primary-danger-button"
						disabled={projectDetail.archivingProject}
						onclick={confirmDeleteProject}
					>
						{t('projects.detail.deleteProjectConfirmConfirm')}
					</button>
				</div>
			</dialog>
		{/if}

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
						disabled={projectDetail.shareStatus === 'revoking'}
						onclick={confirmRevokeShare}
					>
						{t('projects.detail.shareRevokeConfirmConfirm')}
					</button>
				</div>
			</dialog>
		{/if}
	{/if}
</main>

<style>
	.project-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.back-link {
		align-self: flex-start;
		color: var(--color-muted);
		font-size: 0.875rem;
		text-decoration: none;
	}

	.back-link:hover,
	.back-link:focus-visible {
		color: var(--color-accent);
	}

	.project-shell {
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: clamp(1rem, 2vw, 1.5rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow);
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
		font-size: 0.9375rem;
	}

	.error {
		color: var(--color-danger);
	}

	.header-row {
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.rename-form {
		display: flex;
		gap: 0.625rem;
		flex-wrap: wrap;
		flex: 1;
		min-width: 16rem;
	}

	.rename-form input,
	.share-link input {
		flex: 1 1 16rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
	}

	.rename-form input {
		font-size: 1rem;
		font-weight: 700;
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

	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.section-heading h2 {
		margin: 0;
		font-size: 1.125rem;
		color: var(--color-text);
	}

	.sessions-section,
	.share-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	.sessions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 1rem;
		padding: 0;
		margin: 0;
		list-style: none;
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

	@media (max-width: 720px) {
		.project-page {
			padding: 1rem;
		}

		.project-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}
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
