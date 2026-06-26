// Security-event logging for auth (NFR-6). Logs enough to investigate failures
// without leaking secrets: never log signatures, nonces, or cookie values. The
// pubkey is public identity and is safe to record.

export function logAuthFailure(event: string, detail: Record<string, string> = {}): void {
	console.warn(JSON.stringify({ level: 'warn', area: 'auth', event, ...detail }));
}
