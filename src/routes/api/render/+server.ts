import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, parseBody, renderRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { deductQuota, getOrCreateQuota, getUserIdByPubkey, hasQuota } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { renderInterior } from '$lib/server/generation';

// Session is enforced centrally in hooks.server.ts (guardedPaths).
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, renderRequestSchema);
	if (!parsed.ok) return parsed.response;

	// The demo session bypasses D1 entirely (hooks.server.ts) — no quota enforcement.
	const demoUser = dev && locals.user.pubkey === DEMO_PUBKEY;
	const db = demoUser ? null : getDb(platform);
	const userId = db ? await getUserIdByPubkey(db, locals.user.pubkey) : null;

	// A real session is only ever set from a D1 users↔sessions join (hooks.server.ts),
	// so a resolvable session with no matching user row is a data-integrity fault, not
	// a normal "no quota yet" case — fail closed rather than silently skip billing.
	if (db && !userId) return apiError(500, 'account_error', 'Account record not found');

	if (db && userId) {
		const quota = await getOrCreateQuota(db, userId);
		if (!hasQuota(quota)) {
			return apiError(402, 'quota_exceeded', 'Generation limit reached');
		}
	}

	try {
		const result = await renderInterior(platform, parsed.data);
		if (db && userId) await deductQuota(db, userId, result.cost);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Render failed';
		return apiError(500, 'render_failed', message);
	}
};
