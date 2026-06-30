import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Only proxy from known UploadThing CDN hostnames.
const ALLOWED_HOSTS = ['utfs.io', 'ufs.sh'];

function isAllowedSrc(src: string): boolean {
	try {
		const { hostname } = new URL(src);
		return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
	} catch {
		return false;
	}
}

// Public — no session required. The render service fetches this URL server-side
// to download the image; the URL is opaque to end users.
export const GET: RequestHandler = async ({ url }) => {
	const src = url.searchParams.get('src');
	if (!src || !isAllowedSrc(src)) throw error(400, 'Invalid or missing src');

	const upstream = await fetch(src);
	if (!upstream.ok) throw error(502, 'Failed to fetch image from storage');

	return new Response(upstream.body, {
		headers: {
			'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
};
