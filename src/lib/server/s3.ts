/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

import { S3mini } from 's3mini';
import type { Bucket } from '$lib/server/media';

const MAX_PRESIGNED_TTL_SECONDS = 604_800;
const PRESIGNED_TTLS = {
	ui: ['S3_PRESIGNED_UI_TTL_SECONDS', 43_200],
	provider: ['S3_PRESIGNED_PROVIDER_TTL_SECONDS', 10_800]
} as const;

export type S3PresignPurpose = keyof typeof PRESIGNED_TTLS;

function endpointUrl(bucket: Bucket): URL {
	let url: URL;
	try {
		url = new URL(bucket.url);
	} catch {
		throw new Error(`bucket ${bucket.name} URL is invalid`);
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
		throw new Error(`bucket ${bucket.name} URL is invalid`);
	}
	return url;
}

function ttl(value: string | undefined, name: string, fallback: number): number {
	if (value === undefined) return fallback;
	if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} is invalid`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > MAX_PRESIGNED_TTL_SECONDS) {
		throw new Error(`${name} is invalid`);
	}
	return parsed;
}

function configuration(
	platform: App.Platform | undefined,
	bucket: Bucket
): {
	s3: S3mini;
	ttls: Record<S3PresignPurpose, number>;
} {
	const env = platform?.env;
	if (!env?.S3_ACCESS_KEY_ID) throw new Error('S3_ACCESS_KEY_ID not configured');
	if (!env.S3_SECRET_ACCESS_KEY) throw new Error('S3_SECRET_ACCESS_KEY not configured');
	if (!bucket.region || bucket.region.trim() !== bucket.region) {
		throw new Error(`bucket ${bucket.name} region is invalid`);
	}

	return {
		s3: new S3mini({
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			endpoint: endpointUrl(bucket).toString(),
			region: bucket.region
		}),
		ttls: Object.fromEntries(
			Object.entries(PRESIGNED_TTLS).map(([purpose, [name, fallback]]) => [
				purpose,
				ttl(env[name], name, fallback)
			])
		) as Record<S3PresignPurpose, number>
	};
}

function operationError(operation: string, error: unknown): Error {
	const status =
		typeof error === 'object' &&
		error !== null &&
		'status' in error &&
		typeof error.status === 'number'
			? ` with status ${error.status}`
			: '';
	const kind = error instanceof Error ? error.name : typeof error;
	return new Error(`S3 ${operation} failed${status} (${kind})`);
}

export async function putS3Object(
	platform: App.Platform | undefined,
	bucket: Bucket,
	key: string,
	bytes: ArrayBuffer,
	mime: string
): Promise<void> {
	const { s3 } = configuration(platform, bucket);
	try {
		await s3.putObject(key, new Uint8Array(bytes), mime);
	} catch (error) {
		throw operationError('upload', error);
	}
}

export async function deleteS3Object(
	platform: App.Platform | undefined,
	bucket: Bucket,
	key: string
): Promise<void> {
	const { s3 } = configuration(platform, bucket);
	try {
		if (!(await s3.deleteObject(key))) throw new Error('Delete rejected');
	} catch (error) {
		throw operationError('delete', error);
	}
}

export async function isS3BucketAvailable(
	platform: App.Platform | undefined,
	bucket: Bucket
): Promise<boolean> {
	const { s3 } = configuration(platform, bucket);
	try {
		return await s3.bucketExists();
	} catch (error) {
		throw operationError('health check', error);
	}
}

export async function presignS3Object(
	platform: App.Platform | undefined,
	bucket: Bucket,
	key: string,
	purpose: S3PresignPurpose
): Promise<string> {
	const { s3, ttls } = configuration(platform, bucket);
	const expiresIn = ttls[purpose];
	try {
		return await s3.getPresignedUrl('GET', key, expiresIn);
	} catch (error) {
		throw operationError('presign', error);
	}
}
