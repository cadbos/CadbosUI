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
	import { Eraser, Pencil, Plus, Sun } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import {
		creditErrorKey,
		extractApiErrorCode,
		request,
		renderResultFromResponse,
		type EditOperationType
	} from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { buildShareUrl, slugToTool, type ToolId } from '$lib/state/url-state';
	import { createTabController, formatCredit, logBoundaryError } from '$lib/utils';
	import EditAddObjectTool from '$lib/components/EditAddObjectTool.svelte';
	import EditRemoveObjectTool from '$lib/components/EditRemoveObjectTool.svelte';
	import EditAtmosphereTool from '$lib/components/EditAtmosphereTool.svelte';

	type LucideIcon = typeof Pencil;

	const TOOLS: { id: ToolId; label: TranslationKey; Icon: LucideIcon }[] = [
		{ id: 'freeform', label: 'edit.tool.freeform', Icon: Pencil },
		{ id: 'add-object', label: 'edit.tool.addObject', Icon: Plus },
		{ id: 'remove-object', label: 'edit.tool.removeObject', Icon: Eraser },
		{ id: 'atmosphere', label: 'edit.tool.atmosphere', Icon: Sun }
	];

	// Only ever rendered in edit mode (see Workspace.svelte), so the URL's
	// `tool` query param is this component's tab state.
	const activeTool = $derived(slugToTool(page.url.searchParams.get('tool') ?? undefined));
	let toolTabButtons = $state<HTMLElement[]>([]);
	let applying = $state(false);
	let error = $state<string | null>(null);

	const toolTabs = createTabController({
		itemCount: () => TOOLS.length,
		getActiveIndex: () => TOOLS.findIndex((tool) => tool.id === activeTool),
		setActiveIndex: (index) => {
			goto(buildShareUrl('edit', request, { tool: TOOLS[index].id }), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}).catch((err: unknown) => logBoundaryError('editPanel.toolNavigation', err));
		},
		focusTab: (index) => toolTabButtons[index]?.focus()
	});

	const currentRender = $derived(request.currentRender);
	const isAuthenticated = $derived(auth.status === 'authenticated');
	// Editing targets the latest render/edit result once one exists; before that,
	// it falls back to the room photo uploaded on the Render tab (same underlying
	// state — FR: editing works independent of having rendered first).
	const targetImageUrl = $derived(currentRender?.outputUrls[0] ?? request.image?.url);
	const toolDisabled = $derived(applying || !isAuthenticated);

	function applyTemplate(fill: string): void {
		request.setEditPrompt(fill);
	}

	async function submit(prompt: string, type: EditOperationType): Promise<void> {
		const trimmed = prompt.trim();
		if (!targetImageUrl || !trimmed || applying || !isAuthenticated) return;
		applying = true;
		error = null;

		try {
			const response = await fetch('/api/edit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ image: targetImageUrl, prompt: trimmed })
			});
			if (!response.ok) {
				throw new Error(await extractApiErrorCode(response, 'edit_failed'));
			}
			const result = await response.json();
			const newRender = renderResultFromResponse(result, {
				parentId: currentRender?.id,
				editOp: { type, instruction: trimmed }
			});
			request.applyEditResult(newRender);
			void auth.refreshCredit();
			if (type === 'freeform') request.setEditPrompt('');
			if (auth.canLoadGeneratedImages) void generatedImages.load();
		} catch (err) {
			error = t(editErrorKey(err));
		} finally {
			applying = false;
		}
	}

	function editErrorKey(err: unknown): TranslationKey {
		return creditErrorKey(
			{
				failed: 'edit.failed',
				insufficientCredit: 'edit.insufficientCredit',
				generationRestricted: 'edit.generationRestricted'
			},
			err
		);
	}
</script>

<section class="edit-panel">
	<div class="tool-tabs" role="tablist" aria-label={t('edit.tool.switcher.label')}>
		{#each TOOLS as tool, index (tool.id)}
			{@const Icon = tool.Icon}
			<button
				{@attach (node) => {
					toolTabButtons[index] = node as HTMLElement;
				}}
				type="button"
				role="tab"
				id={`edit-tool-tab-${tool.id}`}
				aria-selected={activeTool === tool.id}
				aria-controls={`edit-tool-panel-${tool.id}`}
				tabindex={activeTool === tool.id ? 0 : -1}
				class:active={activeTool === tool.id}
				onclick={() => toolTabs.activate(index)}
				onkeydown={toolTabs.onKeydown}
			>
				<Icon size={16} strokeWidth={1.8} aria-hidden="true" />
				{t(tool.label)}
			</button>
		{/each}
	</div>

	<div
		class="tool-panel"
		role="tabpanel"
		id={`edit-tool-panel-${activeTool}`}
		aria-labelledby={`edit-tool-tab-${activeTool}`}
		tabindex="0"
	>
		{#if activeTool === 'freeform'}
			<div class="chips">
				<button
					type="button"
					class="chip"
					onclick={() => applyTemplate(t('edit.templateReplaceFill'))}
				>
					{t('edit.templateReplace')}
				</button>
				<button
					type="button"
					class="chip"
					onclick={() => applyTemplate(t('edit.templateColorFill'))}
				>
					{t('edit.templateColor')}
				</button>
			</div>

			<label class="field">
				<span class="field-label">{t('edit.instruction')}</span>
				<textarea
					value={request.editPrompt}
					oninput={(event) => request.setEditPrompt(event.currentTarget.value)}
					rows="3"
					disabled={applying}
					placeholder={t('edit.templateReplaceFill')}></textarea>
			</label>

			<div class="actions">
				<button
					type="button"
					class="btn-apply"
					disabled={!request.editPrompt.trim() || toolDisabled || !targetImageUrl}
					onclick={() => void submit(request.editPrompt, 'freeform')}
				>
					{#if applying}
						<span class="spinner" aria-hidden="true"></span>
					{/if}
					{applying ? t('edit.applying') : t('edit.apply')}
				</button>
			</div>
		{:else if activeTool === 'add-object'}
			<EditAddObjectTool
				disabled={toolDisabled || !targetImageUrl}
				{applying}
				onApply={(prompt) => void submit(prompt, 'add-object')}
			/>
		{:else if activeTool === 'remove-object'}
			<EditRemoveObjectTool
				disabled={toolDisabled || !targetImageUrl}
				{applying}
				onApply={(prompt) => void submit(prompt, 'remove-object')}
			/>
		{:else if activeTool === 'atmosphere'}
			<EditAtmosphereTool
				disabled={toolDisabled || !targetImageUrl}
				{applying}
				onApply={(prompt) => void submit(prompt, 'atmosphere')}
			/>
		{/if}
	</div>

	{#if !isAuthenticated}
		<p class="auth-hint">{t('edit.signInToApply')}</p>
	{/if}

	{#if currentRender?.editOp}
		<div class="meta">
			<span>{ti('edit.cost', { cost: formatCredit(currentRender.cost) })}</span>
			<span class="sep">·</span>
			<span>{ti('edit.balance', { balance: formatCredit(currentRender.balance) })}</span>
		</div>
	{/if}

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

	.tool-tabs {
		display: flex;
		gap: 0.375rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 12px;
		flex-wrap: wrap;
	}

	.tool-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tool-tabs button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		justify-content: center;
		padding: 0.5rem 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.tool-tabs button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
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

	.auth-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
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

	.meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.meta .sep {
		opacity: 0.4;
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
