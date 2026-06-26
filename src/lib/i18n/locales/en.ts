import type { Dictionary } from '$lib/i18n/index.svelte';

export const en: Dictionary = {
	'app.title': 'Cadbos — Interior Design AI',
	'app.subtitle': 'Upload a room photo and build a prompt in the interface you prefer.',
	'view.switcher.label': 'Input method',
	'view.chat': 'Chat',
	'view.keyValue': 'Key-value',
	'view.graph': 'Graph',
	'view.chat.placeholder': 'The chat interface will appear here.',
	'view.keyValue.placeholder': 'The key-value interface will appear here.',
	'view.graph.placeholder': 'The graph interface will appear here.',
	'boundary.failed': 'This section failed to load.',
	'auth.login.nip07': 'Sign in with Nostr extension',
	'auth.connecting': 'Connecting…',
	'auth.logout': 'Sign out',
	'auth.error.extensionMissing': 'No Nostr extension found. Install Alby or nos2x.',
	'auth.error.rejected': 'Sign-in was declined in the signer.',
	'auth.error.failed': 'Sign-in failed. Please try again.'
};
