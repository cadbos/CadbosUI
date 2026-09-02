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
	import { Eraser, Lightbulb, PaintRoller, Pencil, Plus, Replace } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import {
		creditErrorKey,
		extractApiErrorCode,
		request,
		RequestImageUploadError,
		renderResultFromResponse,
		type EditOperationType
	} from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { objectAdder } from '$lib/state/object-adder.svelte';
	import { buildWorkspaceUrl, slugToTool, type ToolId } from '$lib/state/url-state';
	import { createTabController, logBoundaryError } from '$lib/utils';
	import EditAddObjectTool from '$lib/components/EditAddObjectTool.svelte';
	import EditRemoveObjectTool from '$lib/components/EditRemoveObjectTool.svelte';
	import LightSettingsPanel from '$lib/components/LightSettingsPanel.svelte';
	import ObjectAdderPanel from '$lib/components/ObjectAdderPanel.svelte';
	import ObjectReplacementPanel from '$lib/components/ObjectReplacementPanel.svelte';
	import TextureReplacementPanel from '$lib/components/TextureReplacementPanel.svelte';

	type LucideIcon = typeof Pencil;

	const TOOLS: {
		id: ToolId;
		label: TranslationKey;
		Icon: LucideIcon;
		alphaLabel?: TranslationKey;
	}[] = [
		{ id: 'freeform', label: 'edit.tool.freeform', Icon: Pencil },
		{ id: 'add-object', label: 'edit.tool.addObject', Icon: Plus },
		{ id: 'remove-object', label: 'edit.tool.removeObject', Icon: Eraser },
		{ id: 'light-settings', label: 'edit.tool.lightSettings', Icon: Lightbulb },
		{
			id: 'object-replacement',
			label: 'mode.objectReplacement',
			Icon: Replace,
			alphaLabel: 'objectReplacement.alpha'
		},
		{
			id: 'texture-replacement',
			label: 'mode.textureReplacement',
			Icon: PaintRoller,
			alphaLabel: 'textureReplacement.alpha'
		}
	];

	// Only ever rendered in edit mode (see Workspace.svelte), so the URL's
	// `tool` query param is this component's tab state.
	const activeTool = $derived(slugToTool(page.url.searchParams.get('tool') ?? undefined));
	let toolTabButtons = $state<HTMLElement[]>([]);
	let applying = $state(false);
	let error = $state<string | null>(null);
	let objectReplacementOpened = $state(false);
	let textureReplacementOpened = $state(false);
	let lightSettingsOpened = $state(false);
	let objectAdderOpened = $state(false);

	$effect(() => {
		if (activeTool === 'object-replacement') objectReplacementOpened = true;
		if (activeTool === 'texture-replacement') textureReplacementOpened = true;
		if (activeTool === 'light-settings') lightSettingsOpened = true;
		if (objectAdder.referenceMode) objectAdderOpened = true;
	});

	const toolTabs = createTabController({
		itemCount: () => TOOLS.length,
		getActiveIndex: () => TOOLS.findIndex((tool) => tool.id === activeTool),
		setActiveIndex: (index) => {
			return goto(buildWorkspaceUrl('edit', request, { tool: TOOLS[index].id }), {
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
	// state — FR: editing works independent of having rendered first). A photo
	// picked but not yet uploaded (request.pendingImageFile) already counts here —
	// the actual upload is deferred, not skipped, see request.resolveEditSource().
	const hasEditTarget = $derived(request.hasEditSource());
	const toolDisabled = $derived(applying || !isAuthenticated);

	function applyTemplate(fill: string): void {
		request.setEditPrompt(fill);
	}

	async function submit(prompt: string, type: EditOperationType): Promise<void> {
		const trimmed = prompt.trim();
		if (!hasEditTarget || !trimmed || applying || !isAuthenticated) return;
		applying = true;
		error = null;
		const overlayId = generationOverlay.start('generationOverlay.edit');

		try {
			const source = await request.resolveEditSource();
			if (!source) return;
			const { sessionId } = await request.ensureProjectSession();
			const response = await fetch('/api/edit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					image: source.url,
					...(source.hash ? { imageHash: source.hash } : {}),
					prompt: trimmed,
					sessionId
				})
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
			generationOverlay.stop(overlayId);
		}
	}

	function editErrorKey(err: unknown): TranslationKey {
		if (err instanceof RequestImageUploadError) return 'upload.errorUpload';
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
	<h2 class="panel-heading">{t('edit.title')}</h2>

	<div class="edit-body">
		<div
			class="tool-tabs"
			role="tablist"
			aria-label={t('edit.tool.switcher.label')}
			aria-orientation="vertical"
		>
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
					title={tool.alphaLabel ? `${t(tool.label)} — ${t(tool.alphaLabel)}` : t(tool.label)}
					onclick={() => toolTabs.activate(index)}
					onkeydown={toolTabs.onKeydown}
				>
					<Icon size={18} strokeWidth={1.8} aria-hidden="true" />
					<span class="visually-hidden">
						{t(tool.label)}{#if tool.alphaLabel}
							&nbsp;— {t(tool.alphaLabel)}{/if}
					</span>
					{#if tool.alphaLabel}
						<span class="tool-alpha-dot" aria-hidden="true"></span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="tool-content">
			{#if activeTool === 'add-object'}
				<div class="mode-toggle" role="tablist" aria-label={t('edit.tool.addObject')}>
					<button
						type="button"
						role="tab"
						aria-selected={!objectAdder.referenceMode}
						class:active={!objectAdder.referenceMode}
						onclick={() => objectAdder.setReferenceMode(false)}
					>
						{t('edit.addObject.mode.presets')}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={objectAdder.referenceMode}
						class:active={objectAdder.referenceMode}
						onclick={() => objectAdder.setReferenceMode(true)}
					>
						{t('edit.addObject.mode.reference')}
					</button>
				</div>
			{/if}

			{#if activeTool !== 'object-replacement' && activeTool !== 'texture-replacement' && activeTool !== 'light-settings'}
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
								disabled={!request.editPrompt.trim() || toolDisabled || !hasEditTarget}
								onclick={() => void submit(request.editPrompt, 'freeform')}
							>
								{#if applying}
									<span class="spinner" aria-hidden="true"></span>
								{/if}
								{applying ? t('edit.applying') : t('edit.apply')}
							</button>
						</div>
					{:else if activeTool === 'add-object' && !objectAdder.referenceMode}
						<EditAddObjectTool
							disabled={toolDisabled || !hasEditTarget}
							{applying}
							onApply={(prompt) => void submit(prompt, 'add-object')}
						/>
					{:else if activeTool === 'remove-object'}
						<EditRemoveObjectTool
							disabled={toolDisabled || !hasEditTarget}
							{applying}
							onApply={(prompt) => void submit(prompt, 'remove-object')}
						/>
					{/if}
				</div>
			{/if}

			{#if lightSettingsOpened}
				<div
					class="tool-panel"
					role="tabpanel"
					id="edit-tool-panel-light-settings"
					aria-labelledby="edit-tool-tab-light-settings"
					tabindex="0"
					hidden={activeTool !== 'light-settings'}
				>
					<svelte:boundary
						onerror={(err: unknown) => logBoundaryError('editPanel.lightSettings', err)}
					>
						<LightSettingsPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="error">{t('boundary.failed')}</p>
							<button type="button" class="btn-apply" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}

			{#if objectReplacementOpened}
				<div
					class="tool-panel"
					role="tabpanel"
					id="edit-tool-panel-object-replacement"
					aria-labelledby="edit-tool-tab-object-replacement"
					tabindex="0"
					hidden={activeTool !== 'object-replacement'}
				>
					<svelte:boundary
						onerror={(err: unknown) => logBoundaryError('editPanel.objectReplacement', err)}
					>
						<ObjectReplacementPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="error">{t('boundary.failed')}</p>
							<button type="button" class="btn-apply" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}

			{#if textureReplacementOpened}
				<div
					class="tool-panel"
					role="tabpanel"
					id="edit-tool-panel-texture-replacement"
					aria-labelledby="edit-tool-tab-texture-replacement"
					tabindex="0"
					hidden={activeTool !== 'texture-replacement'}
				>
					<svelte:boundary
						onerror={(err: unknown) => logBoundaryError('editPanel.textureReplacement', err)}
					>
						<TextureReplacementPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="error">{t('boundary.failed')}</p>
							<button type="button" class="btn-apply" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}

			{#if objectAdderOpened}
				<div
					class="tool-panel"
					role="tabpanel"
					id="edit-tool-panel-add-object-reference"
					aria-labelledby="edit-tool-tab-add-object"
					tabindex="0"
					hidden={activeTool !== 'add-object' || !objectAdder.referenceMode}
				>
					<svelte:boundary
						onerror={(err: unknown) => logBoundaryError('editPanel.objectAdder', err)}
					>
						<ObjectAdderPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="error">{t('boundary.failed')}</p>
							<button type="button" class="btn-apply" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}
		</div>
	</div>

	{#if !isAuthenticated && activeTool !== 'object-replacement' && activeTool !== 'texture-replacement' && activeTool !== 'light-settings'}
		<p class="auth-hint">{t('edit.signInToApply')}</p>
	{/if}

	{#if currentRender?.editOp}
		<div class="meta">
			<span>{ti('edit.cost', { cost: currency.format(currentRender.cost) })}</span>
			<span class="sep">·</span>
			<span>{ti('edit.balance', { balance: currency.format(currentRender.balance) })}</span>
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
		box-shadow: var(--shadow-md);
	}

	.edit-body {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}

	.tool-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* A vertical icon rail instead of horizontal tabs — switches the same
	   tools via the same tablist/URL-driven controller, just reoriented.
	   Ordered after .tool-content so it still renders on the right visually
	   despite coming first in the DOM (a keyboard user tabbing through must
	   reach the tabs before the panel they control). */
	.tool-tabs {
		order: 1;
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 12px;
	}

	.tool-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tool-panel[hidden] {
		display: none;
	}

	.mode-toggle {
		display: flex;
		gap: 0.5rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 12px;
	}

	.mode-toggle button {
		flex: 1;
		padding: 0.5rem 1.25rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.mode-toggle button:hover:not(.active) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.mode-toggle button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
	}

	.tool-tabs button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		font: inherit;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.tool-tabs button:hover:not(.active) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.tool-tabs button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	.tool-alpha-dot {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--color-accent);
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
		color: var(--color-accent-text);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
		border: 1.5px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
		border-radius: 100px;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
		white-space: nowrap;
	}

	.chip:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface));
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
