// NIP-46 (Nostr Connect) configuration, shared by the client and the build-time
// CSP. The connect relay is where the client publishes its `nostrconnect://`
// request and listens for the remote signer's response (ОВ-11: a fixed config
// value, not scattered through the code). It must also appear in the CSP
// `connect-src` directive (vite.config.ts) so the browser may open the WebSocket.
export const NOSTR_CONNECT_RELAY = 'wss://relay.nsec.app';
