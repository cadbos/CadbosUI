<script lang="ts">
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	const fragments = $derived([...request.promptFragments].sort((a, b) => a.order - b.order));

	function inputValue(event: Event): string {
		return event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : '';
	}

	function addFragment(): void {
		request.addFragment({ text: '', order: request.promptFragments.length });
	}

	function updateLabel(id: string, event: Event): void {
		const label = inputValue(event);
		request.updateFragment(id, { label: label === '' ? null : label });
	}

	function updateText(id: string, event: Event): void {
		request.updateFragment(id, { text: inputValue(event) });
	}

	function applyPrompt(event: SubmitEvent): void {
		event.preventDefault();
		request.clearPromptOverride();
	}
</script>

<form class="entry" onsubmit={applyPrompt}>
	<div class="fragments">
		{#each fragments as fragment, index (fragment.id)}
			<div class="fragment">
				<label>
					<span>{ti('view.keyValue.label', { order: index + 1 })}</span>
					<input
						value={fragment.label ?? ''}
						oninput={(event) => updateLabel(fragment.id, event)}
					/>
				</label>
				<label>
					<span>{ti('view.keyValue.text', { order: index + 1 })}</span>
					<input value={fragment.text} oninput={(event) => updateText(fragment.id, event)} />
				</label>
				<button
					type="button"
					aria-label={ti('view.keyValue.removeFragment', { order: index + 1 })}
					onclick={() => request.removeFragment(fragment.id)}
				>
					{t('view.keyValue.remove')}
				</button>
			</div>
		{/each}
	</div>
	<div class="actions">
		<button type="button" onclick={addFragment}>{t('view.keyValue.addFragment')}</button>
		<button type="submit">{t('view.keyValue.apply')}</button>
	</div>
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

	.fragments {
		display: grid;
		gap: var(--space-2);
	}

	.fragment {
		display: grid;
		grid-template-columns: minmax(0, 12rem) minmax(0, 1fr) auto;
		align-items: end;
		gap: var(--space-2);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	input,
	button {
		font: inherit;
	}
</style>
