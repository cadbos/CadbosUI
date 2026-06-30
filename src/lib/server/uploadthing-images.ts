const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const FILE_KEY_PATTERN = /^[A-Za-z0-9_.~-]+$/;
const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const STORAGE_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\.ufs\.sh$/;

const IMAGE_MIME_BY_EXTENSION = {
	avif: 'image/avif',
	gif: 'image/gif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
} as const;

type ImageExtension = keyof typeof IMAGE_MIME_BY_EXTENSION;
type ImageMime = (typeof IMAGE_MIME_BY_EXTENSION)[ImageExtension];

const IMAGE_EXTENSIONS = new Set<string>(Object.keys(IMAGE_MIME_BY_EXTENSION));

export function imageCacheControl(): string {
	return CACHE_CONTROL;
}

export function imageExtensionFromMime(mime: string): ImageExtension | null {
	const normalized = normalizeImageContentType(mime);
	if (normalized === null) return null;
	if (normalized === 'image/jpeg') return 'jpg';

	for (const [extension, candidateMime] of Object.entries(IMAGE_MIME_BY_EXTENSION)) {
		if (candidateMime === normalized) return extension as ImageExtension;
	}

	return null;
}

export function imageMimeMatchesExtension(mime: string, extension: string): boolean {
	const normalized = normalizeImageContentType(mime);
	if (normalized === null) return false;

	const expectedMime = IMAGE_MIME_BY_EXTENSION[extension.toLowerCase() as ImageExtension];
	return expectedMime === normalized;
}

export function normalizeImageContentType(contentType: string | null): ImageMime | null {
	const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase();
	if (normalized === undefined) return null;

	return Object.values(IMAGE_MIME_BY_EXTENSION).includes(normalized as ImageMime)
		? (normalized as ImageMime)
		: null;
}

export function parseProxyImageName(
	imageName: string
): { fileKey: string; extension: ImageExtension } | null {
	const dotIndex = imageName.lastIndexOf('.');
	if (dotIndex <= 0 || dotIndex === imageName.length - 1) return null;

	const fileKey = imageName.slice(0, dotIndex);
	const extension = imageName.slice(dotIndex + 1).toLowerCase();
	if (!FILE_KEY_PATTERN.test(fileKey) || !IMAGE_EXTENSIONS.has(extension)) return null;

	return { fileKey, extension: extension as ImageExtension };
}

export function parseUploadthingStorageUrl(storageUrl: string): { fileKey: string } | null {
	let url: URL;
	try {
		url = new URL(storageUrl);
	} catch {
		return null;
	}

	if (url.protocol !== 'https:' || !STORAGE_HOST_PATTERN.test(url.hostname)) return null;

	const match = /^\/f\/([^/]+)$/.exec(url.pathname);
	if (match === null) return null;

	let fileKey: string;
	try {
		fileKey = decodeURIComponent(match[1]);
	} catch {
		return null;
	}
	if (!FILE_KEY_PATTERN.test(fileKey)) return null;

	return { fileKey };
}

export function proxiedUploadthingImageUrl(
	requestUrl: string,
	fileKey: string,
	extension: ImageExtension
): string {
	return new URL(`/img/${encodeURIComponent(fileKey)}.${extension}`, requestUrl).toString();
}

export function uploadthingFileUrl(appId: string, fileKey: string): string | null {
	if (!APP_ID_PATTERN.test(appId) || !FILE_KEY_PATTERN.test(fileKey)) return null;

	return new URL(`/f/${encodeURIComponent(fileKey)}`, `https://${appId}.ufs.sh`).toString();
}
