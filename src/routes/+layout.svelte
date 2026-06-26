<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AuthBar from '$lib/components/AuthBar.svelte';
	import { auth } from '$lib/state/auth.svelte';

	let { children } = $props();

	onMount(() => {
		auth.loadSession();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="app-header">
	<AuthBar />
</header>

{@render children()}

<style>
	.app-header {
		display: flex;
		justify-content: flex-end;
		padding: var(--space-2);
		border-bottom: 1px solid var(--color-border);
	}
</style>
