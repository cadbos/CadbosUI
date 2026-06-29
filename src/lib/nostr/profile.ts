import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';
import type { NostrProfile, RelayInfo } from '$lib/api/contract';
import { NOSTR_PROFILE_BOOTSTRAP_RELAYS } from './connect';

interface ProfilePool {
	querySync(
		relays: string[],
		filter: { kinds: number[]; authors: string[] },
		params: { maxWait: number }
	): Promise<Event[]>;
	close?(relays: string[]): void;
}

interface FetchNostrProfileOptions {
	pool?: ProfilePool;
	relays?: readonly string[];
	allowedReadRelays?: readonly string[];
	maxWait?: number;
}

const PROFILE_KIND = 0;
const RELAY_LIST_KIND = 10002;
const PUBKEY_HEX = /^[0-9a-f]{64}$/;
const DEFAULT_MAX_WAIT = 4000;

export async function fetchNostrProfile(
	pubkey: string,
	options: FetchNostrProfileOptions = {}
): Promise<NostrProfile> {
	if (!PUBKEY_HEX.test(pubkey)) return { relays: [] };

	const pool = options.pool ?? new SimplePool();
	const bootstrapRelays = unique([...NOSTR_PROFILE_BOOTSTRAP_RELAYS, ...(options.relays ?? [])]);
	const allowedReadRelays = new Set(
		unique([...NOSTR_PROFILE_BOOTSTRAP_RELAYS, ...(options.allowedReadRelays ?? [])])
	);
	const maxWait = options.maxWait ?? DEFAULT_MAX_WAIT;
	const closeRelays = new Set(bootstrapRelays);

	try {
		const bootstrapEvents = await pool.querySync(
			bootstrapRelays,
			{ kinds: [PROFILE_KIND, RELAY_LIST_KIND], authors: [pubkey] },
			{ maxWait }
		);
		const relayEvent = latestEvent(bootstrapEvents, RELAY_LIST_KIND);
		const relays = relayEvent ? parseRelayList(relayEvent) : [];
		const readRelays = relays
			.filter((relay) => relay.read && allowedReadRelays.has(relay.url))
			.map((relay) => relay.url);
		const profileRelays = unique([...readRelays, ...bootstrapRelays]);
		profileRelays.forEach((relay) => closeRelays.add(relay));
		const bootstrapProfile = {
			...parseMetadata(latestEvent(bootstrapEvents, PROFILE_KIND)),
			relays
		};

		let profileEvents: Event[] = [];
		if (readRelays.length > 0) {
			try {
				profileEvents = await pool.querySync(
					profileRelays,
					{ kinds: [PROFILE_KIND], authors: [pubkey] },
					{ maxWait }
				);
			} catch {
				return bootstrapProfile;
			}
		}
		const profileEvent = latestEvent([...bootstrapEvents, ...profileEvents], PROFILE_KIND);

		return { ...parseMetadata(profileEvent), relays };
	} catch {
		return { relays: [] };
	} finally {
		pool.close?.([...closeRelays]);
	}
}

export function parseMetadata(event: Event | undefined): Omit<NostrProfile, 'relays'> {
	if (!event) return {};

	try {
		const data: unknown = JSON.parse(event.content);
		if (!isRecord(data)) return {};
		return {
			...(typeof data.name === 'string' && data.name.trim() ? { name: data.name.trim() } : {}),
			...(safeHttpUrl(data.picture) ? { picture: safeHttpUrl(data.picture) } : {}),
			...(typeof data.about === 'string' && data.about.trim() ? { about: data.about.trim() } : {}),
			...(typeof data.nip05 === 'string' && data.nip05.trim() ? { nip05: data.nip05.trim() } : {}),
			...(safeHttpUrl(data.website) ? { website: safeHttpUrl(data.website) } : {})
		};
	} catch {
		return {};
	}
}

export function parseRelayList(event: Event): RelayInfo[] {
	const relays = new Map<string, RelayInfo>();
	for (const tag of event.tags) {
		if (tag[0] !== 'r' || typeof tag[1] !== 'string') continue;
		const url = normalizedRelayUrl(tag[1]);
		if (!url) continue;
		const marker = tag[2];
		relays.set(url, {
			url,
			read: marker !== 'write',
			write: marker !== 'read'
		});
	}
	return [...relays.values()];
}

function latestEvent(events: Event[], kind: number): Event | undefined {
	return events
		.filter((event) => event.kind === kind)
		.toSorted((left, right) => right.created_at - left.created_at)[0];
}

function normalizedRelayUrl(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null;
		url.hash = '';
		url.search = '';
		if (url.pathname === '/') url.pathname = '';
		return url.toString();
	} catch {
		return null;
	}
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function safeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	try {
		const url = new URL(value.trim());
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
