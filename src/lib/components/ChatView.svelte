<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	function getPrompt(): string {
		return request.prompt;
	}

	function setPrompt(value: string): void {
		request.setPromptOverride(value);
	}
</script>

<div class="chat-view">
	<textarea
		bind:value={getPrompt, setPrompt}
		rows="4"
		aria-label={t('view.chat.prompt')}
		aria-describedby="chat-hint"
		placeholder={t('view.chat.placeholder')}></textarea>
	<p class="hint" id="chat-hint">{t('view.chat.hint')}</p>
</div>

<style>
	.chat-view {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}

	textarea {
		width: 100%;
		font: inherit;
		font-size: 0.9375rem;
		line-height: 1.6;
		resize: vertical;
		padding: 0.75rem 1rem;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		transition: border-color 0.15s;
		box-sizing: border-box;
		min-height: 6rem;
	}

	textarea:focus {
		outline: none;
		border-color: var(--color-border-focus);
	}

	textarea::placeholder {
		color: var(--color-muted);
	}

	.hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}
</style>
