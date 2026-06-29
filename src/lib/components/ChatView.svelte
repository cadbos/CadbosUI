<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	function getPrompt(): string {
		return request.prompt;
	}

	function setPrompt(prompt: string): void {
		request.setPromptOverride(prompt);
	}

	function applyPrompt(): void {
		request.setPromptOverride(request.prompt);
	}
</script>

<form class="entry" onsubmit={(event) => event.preventDefault()}>
	<label>
		<span>{t('view.chat.prompt')}</span>
		<textarea bind:value={getPrompt, setPrompt} rows="5"></textarea>
	</label>
	<button type="button" onclick={applyPrompt}>{t('view.chat.apply')}</button>
</form>

<style>
	.entry {
		width: min(100%, 34rem);
		display: grid;
		gap: var(--space-2);
	}

	label {
		display: grid;
		gap: var(--space-1);
	}

	textarea {
		min-height: 8rem;
		resize: vertical;
	}

	textarea,
	button {
		font: inherit;
	}

	button {
		justify-self: start;
	}
</style>
