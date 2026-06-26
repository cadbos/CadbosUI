<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
</script>

<p class="placeholder">{t('view.graph.placeholder')}</p>

<style>
	.placeholder {
		margin: 0;
		padding: var(--space-4);
		color: var(--color-muted);
		text-align: center;
	}
</style>
