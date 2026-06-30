import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, parseBody, profileUpdateRequestSchema } from '$lib/server/api';
import { getDb, updateUserProfile } from '$lib/server/auth/repository';

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, profileUpdateRequestSchema);
	if (!parsed.ok) return parsed.response;

	const user = await updateUserProfile(
		getDb(platform),
		locals.user.pubkey,
		parsed.data.firstName,
		parsed.data.lastName
	);

	return json({ user });
};
