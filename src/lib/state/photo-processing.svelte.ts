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

import { z } from 'zod';
import { untrack } from 'svelte';
import {
	mediaAccessSchema,
	type RenderResponse,
	type RequestFormSnapshot
} from '$lib/api/contract';
import { t, type TranslationKey } from '$lib/i18n/index.svelte';
import {
	defaultPhotoAdjustments,
	hasPhotoAdjustments,
	MAX_PROCESSED_PHOTO_SIZE,
	PHOTO_PRESETS,
	type PhotoAdjustments
} from '$lib/photo-adjustments';
import { processPhoto } from '$lib/photo-processing-client';
import { auth } from '$lib/state/auth.svelte';
import { generatedImages } from '$lib/state/generated-images.svelte';
import { generationOverlay } from '$lib/state/generation-overlay.svelte';
import { mediaAccess } from '$lib/state/media-access.svelte';
import {
	creditErrorKey,
	extractApiErrorCode,
	request,
	RequestState,
	renderResultFromResponse,
	type RenderResult
} from '$lib/state/request.svelte';
import { workspaceTabs } from '$lib/state/workspace-tabs.svelte';

const responseSchema = z.object({
	id: z.string().min(1).optional(),
	output: mediaAccessSchema,
	cost: z.number().nonnegative(),
	balance: z.number()
});

interface PhotoOperation {
	requestId: string;
	pubkey: string;
	state: RequestState;
	baseImageKey: string | undefined;
	pendingFile: File | undefined;
	sessionId: string | undefined;
	sourceRender: RenderResult | undefined;
	sourceKey: string | undefined;
	sourceUrl: string;
	formSnapshot: RequestFormSnapshot;
}

function sameAdjustments(left: PhotoAdjustments, right: PhotoAdjustments): boolean {
	return Object.entries(left).every(
		([key, value]) => right[key as keyof PhotoAdjustments] === value
	);
}

class PhotoProcessingState {
	previewUrl = $state<string | undefined>(undefined);
	presetPreviewUrls = $state<Record<string, string>>({});
	loading = $state(false);
	showOriginal = $state(false);
	saving = $state(false);
	upscaling = $state(false);
	notice = $state<string | null>(null);
	completedResultUrl = $state<string | null>(null);
	#actionError = $state<string | null>(null);
	#previewError = $state<string | null>(null);
	#previewAbort: AbortController | null = null;
	#presetsAbort: AbortController | null = null;
	#previewTimer: ReturnType<typeof setTimeout> | undefined;
	#previewSourceUrl: string | undefined;

	busy = $derived(this.saving || this.upscaling);
	error = $derived(this.#actionError ?? this.#previewError);
	sourceKey = $derived(
		request.currentRender?.editOp?.type === 'photo-processing'
			? (request.currentRender.sourceKey ?? request.previousRender?.outputKey)
			: request.workingImageKey()
	);
	sourceUrl = $derived(
		request.currentRender?.editOp?.type === 'photo-processing' && this.sourceKey
			? mediaAccess.get(this.sourceKey)?.url
			: request.workingImageUrl()
	);
	hasChanges = $derived(
		!sameAdjustments(
			request.photoAdjustments,
			request.currentRender?.editOp?.type === 'photo-processing'
				? (request.currentRender.formSnapshot?.photoAdjustments ?? defaultPhotoAdjustments())
				: defaultPhotoAdjustments()
		)
	);
	canSave = $derived(
		auth.status === 'authenticated' && request.hasWorkingImage() && this.hasChanges && !this.busy
	);
	canUpscale = $derived(auth.status === 'authenticated' && request.hasWorkingImage() && !this.busy);

	preview(url: string | undefined, settings: PhotoAdjustments): void {
		untrack(() => {
			this.#previewAbort?.abort();
			clearTimeout(this.#previewTimer);
			this.#previewTimer = undefined;
			this.#previewError = null;
			if (url !== this.#previewSourceUrl || !hasPhotoAdjustments(settings)) {
				if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
				this.previewUrl = undefined;
			}
			this.#previewSourceUrl = url;
			if (!url || !hasPhotoAdjustments(settings)) {
				this.#previewAbort = null;
				this.loading = false;
				return;
			}
			const controller = new AbortController();
			this.#previewAbort = controller;
			this.loading = true;
			const capturedSettings = { ...settings };
			this.#previewTimer = setTimeout(() => {
				this.#previewTimer = undefined;
				void this.#renderPreview(url, capturedSettings, controller);
			}, 100);
		});
	}

	async #renderPreview(
		url: string,
		settings: PhotoAdjustments,
		controller: AbortController
	): Promise<void> {
		try {
			const blob = await processPhoto(url, settings, 1600, controller.signal);
			if (controller.signal.aborted) return;
			if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
			this.previewUrl = URL.createObjectURL(blob);
		} catch (error) {
			if (controller.signal.aborted) return;
			this.#previewError = this.#errorMessage(error, 'photoProcessing.previewFailed');
		} finally {
			if (this.#previewAbort === controller) this.loading = false;
		}
	}

	clearPreview(): void {
		this.#previewAbort?.abort();
		this.#previewAbort = null;
		this.#previewSourceUrl = undefined;
		clearTimeout(this.#previewTimer);
		this.#previewTimer = undefined;
		if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
		this.previewUrl = undefined;
		this.loading = false;
	}

	preparePresets(url: string | undefined): void {
		untrack(() => {
			this.clearPresets();
			if (!url) return;
			const controller = new AbortController();
			this.#presetsAbort = controller;
			void this.#renderPresets(url, controller);
		});
	}

	async #renderPresets(url: string, controller: AbortController): Promise<void> {
		let thumbnailUrl: string | undefined;
		try {
			const thumbnail = await processPhoto(url, defaultPhotoAdjustments(), 160, controller.signal);
			if (controller.signal.aborted) return;
			thumbnailUrl = URL.createObjectURL(thumbnail);
			for (const preset of PHOTO_PRESETS) {
				const blob = await processPhoto(thumbnailUrl, preset.adjustments, 160, controller.signal);
				if (controller.signal.aborted) return;
				this.presetPreviewUrls = {
					...this.presetPreviewUrls,
					[preset.id]: URL.createObjectURL(blob)
				};
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			this.#previewError = this.#errorMessage(error, 'photoProcessing.previewFailed');
		} finally {
			if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
		}
	}

	clearPresets(): void {
		this.#presetsAbort?.abort();
		this.#presetsAbort = null;
		for (const url of Object.values(this.presetPreviewUrls)) URL.revokeObjectURL(url);
		this.presetPreviewUrls = {};
	}

	async save(): Promise<void> {
		if (!this.canSave) return;
		const operation = this.#capture(true);
		if (!operation) return;
		this.saving = true;
		this.#clearFeedback();
		try {
			await this.#save(operation);
		} catch (error) {
			this.#actionError = this.#errorMessage(error, 'photoProcessing.saveFailed');
		} finally {
			operation.state.setPendingImage(undefined);
			this.saving = false;
		}
	}

	async upscale(fromPhotoProcessing = false): Promise<void> {
		if (!this.canUpscale || (!fromPhotoProcessing && !request.currentRender)) return;
		const needsSave = fromPhotoProcessing && this.hasChanges;
		const operation = this.#capture(fromPhotoProcessing);
		if (!operation) return;
		this.upscaling = true;
		this.#clearFeedback();
		const overlayId = generationOverlay.start('generationOverlay.upscale');
		try {
			if (needsSave && !(await this.#save(operation))) return;
			operation.sourceRender = operation.state.currentRender;
			operation.sourceKey = operation.state.workingImageKey();
			operation.state.resetPhotoAdjustments();
			operation.formSnapshot = operation.state.captureFormSnapshot('upscale');
			await this.#prepare(operation);
			this.#requireOwner(operation);
			const response = await fetch('/api/upscale', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					imageKey: operation.sourceKey,
					outputFormat: operation.formSnapshot.outputFormat,
					sessionId: operation.state.sessionId,
					formSnapshot: operation.formSnapshot
				})
			});
			const result = await this.#readResponse(response, 'upscale_failed');
			this.#apply(
				operation,
				result,
				{
					type: 'upscale',
					instruction: t('toolbar.upscaleDone')
				},
				fromPhotoProcessing ? undefined : operation.sourceRender?.sourceMode
			);
			const owner = this.#owner(operation);
			owner?.resetPhotoAdjustments();
		} catch (error) {
			this.#actionError = this.#errorMessage(error, 'toolbar.upscaleFailed');
		} finally {
			operation.state.setPendingImage(undefined);
			this.upscaling = false;
			generationOverlay.stop(overlayId);
		}
	}

	#capture(usePhotoSource: boolean): PhotoOperation | null {
		const pubkey = auth.pubkey;
		const state = new RequestState();
		state.copyFrom(request);
		const sourceKey = usePhotoSource ? this.sourceKey : state.workingImageKey();
		const sourceUrl = sourceKey ? mediaAccess.get(sourceKey)?.url : state.workingImageUrl();
		if (!sourceUrl || !pubkey) {
			state.setPendingImage(undefined);
			return null;
		}
		return {
			requestId: request.id,
			pubkey,
			state,
			baseImageKey: state.image && 'mediaKey' in state.image ? state.image.mediaKey : undefined,
			pendingFile: state.pendingImageFile,
			sessionId: state.sessionId,
			sourceRender: state.currentRender,
			sourceKey,
			sourceUrl,
			formSnapshot: state.captureFormSnapshot('photo-processing')
		};
	}

	#owner(operation: PhotoOperation): RequestState | undefined {
		if (auth.pubkey !== operation.pubkey || auth.status !== 'authenticated') return undefined;
		const owner = workspaceTabs.requestState(operation.requestId);
		if (!owner || owner.sessionId !== operation.sessionId) return undefined;
		const imageKey = owner.image && 'mediaKey' in owner.image ? owner.image.mediaKey : undefined;
		return owner.pendingImageFile === operation.pendingFile && imageKey === operation.baseImageKey
			? owner
			: undefined;
	}

	#requireOwner(operation: PhotoOperation): RequestState {
		const owner = this.#owner(operation);
		if (!owner) throw new Error('photo_processing_superseded');
		return owner;
	}

	async #prepare(operation: PhotoOperation): Promise<void> {
		this.#requireOwner(operation);
		if (!operation.sourceKey) {
			operation.sourceKey = await operation.state.resolveWorkingImageKey();
			const owner = this.#requireOwner(operation);
			if (!operation.sourceKey || !operation.state.image)
				throw new Error('photo_processing_missing_image');
			owner.setImage(operation.state.image);
			operation.baseImageKey = operation.sourceKey;
			operation.pendingFile = undefined;
		}
		const { projectId, sessionId } = await operation.state.ensureProjectSession();
		this.#requireOwner(operation);
		workspaceTabs.attachCreatedSession(operation.requestId, projectId, sessionId);
		operation.sessionId = sessionId;
	}

	async #save(operation: PhotoOperation): Promise<boolean> {
		const blob = await processPhoto(
			operation.sourceUrl,
			operation.formSnapshot.photoAdjustments ?? defaultPhotoAdjustments(),
			undefined,
			undefined,
			operation.formSnapshot.outputFormat
		);
		const outputFormat =
			blob.type === 'image/jpeg'
				? 'jpg'
				: blob.type === 'image/png'
					? 'png'
					: blob.type === 'image/avif'
						? 'avif'
						: 'webp';
		operation.formSnapshot = { ...operation.formSnapshot, outputFormat };
		if (blob.size > MAX_PROCESSED_PHOTO_SIZE) throw new Error('photo_processing_image_too_large');
		await this.#prepare(operation);
		this.#requireOwner(operation);
		const body = new FormData();
		body.append('file', blob, `photo.${operation.formSnapshot.outputFormat}`);
		body.append('imageKey', operation.sourceKey ?? '');
		body.append('sessionId', operation.sessionId ?? '');
		body.append('formSnapshot', JSON.stringify(operation.formSnapshot));
		const response = await fetch('/api/photo-processing', { method: 'POST', body });
		const result = await this.#readResponse(response, 'photo_processing_failed');
		return this.#apply(operation, result, { type: 'photo-processing', instruction: '' });
	}

	#apply(
		operation: PhotoOperation,
		result: RenderResponse,
		editOp: RenderResult['editOp'],
		sourceMode?: RenderResult['sourceMode']
	): boolean {
		if (auth.pubkey !== operation.pubkey || auth.status !== 'authenticated') return false;
		const render = renderResultFromResponse(result, {
			parentId: operation.sourceRender?.id,
			sourceKey: operation.sourceKey,
			editOp,
			sourceMode,
			formSnapshot: operation.formSnapshot
		});
		const owner = this.#owner(operation);
		if (owner) owner.applyEditResult(render, operation.sourceRender);
		else {
			this.completedResultUrl = mediaAccess.get(render.outputKey)?.url ?? result.output.url;
			this.notice = t(result.id ? 'photoProcessing.savedToHistory' : 'photoProcessing.resultReady');
		}
		operation.state.applyEditResult(render, operation.sourceRender);
		void auth.refreshCredit();
		if (auth.canLoadGeneratedImages) void generatedImages.load();
		return owner !== undefined;
	}

	async #readResponse(response: Response, fallbackCode: string): Promise<RenderResponse> {
		if (!response.ok) throw new Error(await extractApiErrorCode(response, fallbackCode));
		const parsed = responseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success) throw new Error(fallbackCode);
		return parsed.data;
	}

	#clearFeedback(): void {
		this.#actionError = null;
		this.notice = null;
		this.completedResultUrl = null;
	}

	#errorMessage(error: unknown, failed: TranslationKey): string {
		if (error instanceof Error) {
			if (
				error.message === 'photo_processing_image_too_large' ||
				error.message === 'image_too_large' ||
				error.message === 'too_large'
			)
				return t('photoProcessing.imageTooLarge');
			if (error.message === 'rate_limited') return t('photoProcessing.rateLimited');
			if (error.message === 'photo_processing_superseded')
				return t('photoProcessing.operationSuperseded');
		}
		return t(
			creditErrorKey(
				{
					failed,
					insufficientCredit: 'photoProcessing.insufficientCredit',
					generationRestricted: 'photoProcessing.generationRestricted'
				},
				error
			)
		);
	}
}

export const photoProcessing = new PhotoProcessingState();
