import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { NostrProfile } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { fetchNostrProfile } from '$lib/nostr/profile';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const profile = await fetchNostrProfile(locals.user.pubkey);
	return json({ profile } satisfies { profile: NostrProfile });
};
