import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

type ImageRouteEvent = Parameters<typeof GET>[0];

function platform(appId = 'app-id'): App.Platform {
	return { env: { UPLOADTHING_APP_ID: appId } } as App.Platform;
}

function call(event: Partial<ImageRouteEvent>): ReturnType<typeof GET> {
	return GET(event as ImageRouteEvent);
}

describe('/img image proxy', () => {
	it('streams an Uploadthing image with cache and content type headers', async () => {
		const fetch = vi.fn(async () => {
			return new Response('image-bytes', {
				headers: { 'content-type': 'image/jpeg; charset=binary' }
			});
		});

		const response = await call({
			params: { image: 'file-key.jpg' },
			platform: platform(),
			fetch
		});

		expect(fetch).toHaveBeenCalledWith('https://app-id.ufs.sh/f/file-key');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(await response.text()).toBe('image-bytes');
	});

	it('rejects paths whose extension does not match the stored image', async () => {
		const fetch = vi.fn(async () => {
			return new Response('image-bytes', {
				headers: { 'content-type': 'image/png' }
			});
		});

		await expect(
			call({
				params: { image: 'file-key.jpg' },
				platform: platform(),
				fetch
			})
		).rejects.toMatchObject({ status: 400 });

		expect(fetch).toHaveBeenCalledWith('https://app-id.ufs.sh/f/file-key');
	});

	it('rejects invalid image paths before fetching storage', async () => {
		const fetch = vi.fn();

		await expect(
			call({
				params: { image: 'file-key.txt' },
				platform: platform(),
				fetch
			})
		).rejects.toMatchObject({ status: 400 });

		expect(fetch).not.toHaveBeenCalled();
	});
});
