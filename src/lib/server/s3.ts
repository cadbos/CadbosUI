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

function s3Client(platform: App.Platform | undefined, bucket: Bucket): S3mini {
	const env = platform?.env;
	if (!env?.S3_ACCESS_KEY_ID) throw new Error('S3_ACCESS_KEY_ID not configured');
	if (!env.S3_SECRET_ACCESS_KEY) throw new Error('S3_SECRET_ACCESS_KEY not configured');
	if (!bucket.region || bucket.region.trim() !== bucket.region) {
		throw new Error(`bucket ${bucket.name} region is invalid`);
	}

	return new S3mini({
		accessKeyId: env.S3_ACCESS_KEY_ID,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		endpoint: endpointUrl(bucket).toString(),
		region: bucket.region
	});
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
	const s3 = s3Client(platform, bucket);
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
	const s3 = s3Client(platform, bucket);
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
	const s3 = s3Client(platform, bucket);
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
	expiresIn: number
): Promise<string> {
	const s3 = s3Client(platform, bucket);
	try {
		return await s3.getPresignedUrl('GET', key, expiresIn);
	} catch (error) {
		throw operationError('presign', error);
	}
}
