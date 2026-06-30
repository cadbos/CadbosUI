// NIP-46 (Nostr Connect) configuration, shared by the client and the build-time
// CSP. These are the rendezvous relays where the client publishes its
// `nostrconnect://` request and listens for the remote signer's response
// (ОВ-11: fixed config, not scattered through the code). They must also appear in
// the CSP `connect-src` directive (vite.config.ts) so the browser may open the
// WebSockets.
//
// More than one relay is listed on purpose: NIP-46 only works if the client and
// the signer can both reach a common relay, and nostr-tools' pool closes the
// connection (failing the login) if no relay answers within ~3s. A couple of
// widely-available general-purpose relays make that handshake resilient to any one
// of them being down.
// `as const` keeps the entries as string literals so they satisfy the CSP
// `connect-src` source type at build time; runtime callers spread into a fresh
// `string[]` where a mutable array is needed.
export const NOSTR_CONNECT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'] as const;

export const NOSTR_PROFILE_BOOTSTRAP_RELAYS = [
	...NOSTR_CONNECT_RELAYS,
	'wss://nostr.band',
	'wss://nostr-pub.wellorder.net'
] as const;
