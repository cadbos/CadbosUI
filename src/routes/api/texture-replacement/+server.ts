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

import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { TextureReplacementJobResponse } from '$lib/api/contract';
import { apiError, parseBody, textureReplacementRequestSchema } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { touchRateLimit } from '$lib/server/auth/rate-limit';
import { authenticationRequiredResponse } from '$lib/server/auth/session';
import {
	assertGenerationAllowed,
	getCredit,
	getUserIdByPubkey,
	recordBalance
} from '$lib/server/billing';
import { ComfyUiError } from '$lib/server/comfyui';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { replaceTexturesWithMask, type StoredRenderResponse } from '$lib/server/generation';
import { recordGeneration } from '$lib/server/generations';
import { getOrCreateMediaByKey } from '$lib/server/media';
import { mediaAccess, providerMediaBatch } from '$lib/server/media-access';
import { assertSessionOwnedByUser } from '$lib/server/projects';
import { RemoteImageImportError } from '$lib/server/remote-image';
import {
	cancelTextureReplacement,
	submitTextureReplacement,
	textureReplacementCost
} from '$lib/server/texture-replacement';
import { createTextureReplacementJob } from '$lib/server/texture-replacement-jobs';

const TEXTURE_REPLACEMENT_RATE_LIMIT = { windowMs: 60_000, max: 10 } as const;
const textureReplacementInFlight = new Set<string>();

function logRejection(status: number, reason: string): void {
	console.warn(
		JSON.stringify({
			level: 'warn',
			area: 'texture-replacement',
			event: 'request_rejected',
			status,
			reason
		})
	);
}

function remoteImageError(error: RemoteImageImportError): Response {
	switch (error.code) {
		case 'invalid_url':
			return apiError(400, error.code, 'Invalid image URL');
		case 'unsupported_image_type':
			return apiError(415, error.code, 'Unsupported image type');
		case 'image_too_large':
			return apiError(413, error.code, 'Image exceeds the 8 MB limit');
		case 'remote_fetch_failed':
			return apiError(502, error.code, 'Failed to fetch image');
	}
}

export const POST: RequestHandler = async ({ request, platform, locals, url }) => {
	if (!locals.user) {
		const response = authenticationRequiredResponse(locals.sessionLookupUnavailable);
		logRejection(
			response.status,
			locals.sessionLookupUnavailable ? 'authentication_unavailable' : 'unauthorized'
		);
		return response;
	}
	const parsed = await parseBody(request, textureReplacementRequestSchema);
	if (!parsed.ok) return parsed.response;
	if (dev && locals.user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}

	const pubkey = locals.user.pubkey;
	if (textureReplacementInFlight.has(pubkey)) {
		return apiError(409, 'request_in_progress', 'Texture replacement request already in progress');
	}
	textureReplacementInFlight.add(pubkey);

	try {
		const db = getDb(platform);
		const userId = await getUserIdByPubkey(db, pubkey);
		if (!userId) return apiError(500, 'account_error', 'Account record not found');
		const limited = await touchRateLimit(
			db,
			`texture-replacement:${pubkey}`,
			Date.now(),
			TEXTURE_REPLACEMENT_RATE_LIMIT
		);
		if (limited) {
			logRejection(429, 'rate_limited');
			return apiError(429, 'rate_limited', 'Too many requests');
		}

		if (!(await assertSessionOwnedByUser(db, userId, parsed.data.sessionId))) {
			logRejection(404, 'session_not_found');
			return apiError(404, 'session_not_found', 'Session not found');
		}

		const maskedRequest = 'maskImageKey' in parsed.data ? parsed.data : undefined;
		const automaticRequest = 'replacementSurface' in parsed.data ? parsed.data : undefined;
		const mediaKeys = [
			parsed.data.imageKey,
			parsed.data.referenceImageKey,
			...(maskedRequest ? [maskedRequest.maskImageKey] : [])
		];
		const media = await providerMediaBatch(db, platform, mediaKeys);
		if (!media) return apiError(404, 'image_not_found', 'Image not found');
		const sceneMedia = media.get(parsed.data.imageKey)!.media;
		const referenceMedia = media.get(parsed.data.referenceImageKey)!.media;
		const uploadsBucket = sceneMedia.bucket;
		let precheckBalance: number | undefined;
		let comfyCost: number | undefined;
		try {
			const check = await assertGenerationAllowed(db, userId);
			if (!check.allowed) {
				if (check.reason === 'not_approved') {
					logRejection(403, 'generation_restricted');
					return apiError(
						403,
						'generation_restricted',
						'Generation is limited to approved accounts'
					);
				}
				logRejection(402, 'insufficient_credit');
				return apiError(402, 'insufficient_credit', 'Test balance exhausted');
			}
			precheckBalance = check.balance;
			if (automaticRequest) comfyCost = textureReplacementCost(platform);
			if (comfyCost !== undefined && check.balance < comfyCost) {
				logRejection(402, 'insufficient_credit');
				return apiError(402, 'insufficient_credit', 'Test balance exhausted');
			}
		} catch (error) {
			console.error('Texture replacement pre-check failed:', error);
			return apiError(500, 'texture_replacement_failed', 'Texture replacement failed');
		}

		if (maskedRequest) {
			let result: StoredRenderResponse;
			try {
				result = await replaceTexturesWithMask(platform, uploadsBucket, {
					image: media.get(maskedRequest.imageKey)!.url,
					referenceImage: media.get(maskedRequest.referenceImageKey)!.url,
					mask: media.get(maskedRequest.maskImageKey)!.url
				});
			} catch {
				console.error('ArchAI masked texture replacement failed');
				return apiError(502, 'texture_replacement_failed', 'Texture replacement failed');
			}

			try {
				await recordBalance(db, userId, result.balance);
			} catch (error) {
				console.error('recordBalance failed after masked texture replacement:', error);
			}
			try {
				const outputMedia = await getOrCreateMediaByKey(
					db,
					uploadsBucket,
					result.outputKey,
					result.outputHash
				);
				const credit = await recordGeneration(db, userId, {
					resultMediaId: outputMedia.id,
					sourceMediaId: sceneMedia.id,
					sessionId: maskedRequest.sessionId,
					prompt: '',
					kind: 'texture-replacement',
					amount: result.cost
				});
				result = { ...result, balance: credit.balance };
			} catch (error) {
				console.error('recordGeneration failed after masked texture replacement:', error);
				const fallback = await getCredit(db, userId).catch((fallbackError) => {
					console.error('balance fallback failed after masked texture replacement:', fallbackError);
					return null;
				});
				result = { ...result, balance: fallback?.balance ?? precheckBalance ?? 0 };
			}

			return json({
				id: crypto.randomUUID(),
				status: 'completed',
				output: await mediaAccess(
					platform,
					await getOrCreateMediaByKey(db, uploadsBucket, result.outputKey, result.outputHash)
				),
				cost: result.cost,
				balance: result.balance
			} satisfies TextureReplacementJobResponse);
		}

		if (!automaticRequest || comfyCost === undefined) {
			console.error('Texture replacement cost unavailable after pre-check');
			return apiError(500, 'texture_replacement_failed', 'Texture replacement failed');
		}

		const id = crypto.randomUUID();
		let comfyPromptId: string;
		try {
			comfyPromptId = await submitTextureReplacement(
				platform,
				{
					image: media.get(automaticRequest.imageKey)!.url,
					referenceImage: media.get(automaticRequest.referenceImageKey)!.url,
					replacementSurface: automaticRequest.replacementSurface
				},
				url.origin,
				id
			);
		} catch (error) {
			if (error instanceof RemoteImageImportError) return remoteImageError(error);
			if (error instanceof ComfyUiError) {
				console.error('ComfyUI texture replacement submission failed:', {
					code: error.code,
					operation: error.operation,
					status: error.status
				});
				if (error.code === 'invalid_configuration') {
					return apiError(500, 'texture_replacement_failed', 'Texture replacement failed');
				}
			} else {
				console.error('Texture replacement submission failed:', error);
			}
			return apiError(502, 'texture_replacement_failed', 'Texture replacement failed');
		}

		try {
			await createTextureReplacementJob(db, {
				id,
				userId,
				comfyPromptId,
				sceneMediaId: sceneMedia.id,
				sessionId: automaticRequest.sessionId,
				referenceMediaId: referenceMedia.id,
				replacementSurface: automaticRequest.replacementSurface,
				cost: comfyCost,
				createdAt: Date.now()
			});
		} catch {
			console.error('Texture replacement job persistence failed');
			try {
				await cancelTextureReplacement(platform, comfyPromptId);
			} catch (cleanupError) {
				if (cleanupError instanceof ComfyUiError) {
					console.error('ComfyUI texture replacement cleanup failed:', {
						code: cleanupError.code,
						operation: cleanupError.operation,
						status: cleanupError.status
					});
				} else {
					console.error('Texture replacement cleanup failed');
				}
			}
			return apiError(500, 'texture_replacement_failed', 'Texture replacement failed');
		}

		return json({ id, status: 'processing' } satisfies TextureReplacementJobResponse, {
			status: 202,
			headers: {
				'cache-control': 'no-store',
				location: `/api/texture-replacement/${id}`
			}
		});
	} finally {
		textureReplacementInFlight.delete(pubkey);
	}
};
