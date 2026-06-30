import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	imageCacheControl,
	imageMimeMatchesExtension,
	normalizeImageContentType,
	parseProxyImageName,
	uploadthingFileUrl
} from '$lib/server/uploadthing-images';

export const GET: RequestHandler = async ({ params, platform, fetch }) => {
	const parsed = parseProxyImageName(params.image);
	if (parsed === null) throw error(400, 'Invalid image path');

	const appId = platform?.env?.UPLOADTHING_APP_ID;
	if (!appId) throw error(500, 'UPLOADTHING_APP_ID not configured');

	const upstreamUrl = uploadthingFileUrl(appId, parsed.fileKey);
	if (upstreamUrl === null) throw error(500, 'Invalid Uploadthing configuration');

	const upstream = await fetch(upstreamUrl);
	if (!upstream.ok) throw error(502, 'Failed to fetch image from storage');

	const contentType = normalizeImageContentType(upstream.headers.get('content-type'));
	if (contentType === null) throw error(502, 'Storage returned an unsupported image type');
	if (!imageMimeMatchesExtension(contentType, parsed.extension)) {
		throw error(400, 'Image extension does not match image type');
	}

	return new Response(upstream.body, {
		headers: {
			'content-type': contentType,
			'cache-control': imageCacheControl()
		}
	});
};
