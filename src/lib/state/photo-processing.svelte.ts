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
import { tick, untrack } from 'svelte';
import {
	mediaAccessSchema,
	type OutputFormat,
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
import { createPhotoPreview, processPhoto } from '$lib/photo-processing-client';
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

function photoOutputFormat(blob: Blob): OutputFormat {
	switch (blob.type) {
		case 'image/jpeg':
			return 'jpg';
		case 'image/png':
			return 'png';
		case 'image/avif':
			return 'avif';
		case 'image/webp':
			return 'webp';
		default:
			throw new Error('Photo output format unavailable');
	}
}

class PhotoProcessingState {
	previewImage = $state.raw<HTMLImageElement | undefined>(undefined);
	previewUrl = $derived(this.previewImage?.src);
	presetPreviewUrls = $state<Record<string, string>>({});
	loading = $state(false);
	upscaleOnSave = $state(false);
	saving = $state(false);
	upscaling = $state(false);
	downloading = $state(false);
	notice = $state<string | null>(null);
	completedResultUrl = $state<string | null>(null);
	#actionError = $state<string | null>(null);
	#previewError = $state<string | null>(null);
	#previewAbort: AbortController | null = null;
	#presetsAbort: AbortController | null = null;
	#previewSettings: PhotoAdjustments | undefined;
	#previewRenderer: ((settings: PhotoAdjustments) => Promise<Blob>) | undefined;
	#previewRunning = false;
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
			if (url !== this.#previewSourceUrl || !hasPhotoAdjustments(settings)) this.clearPreview();
			this.#previewError = null;
			if (!url || !hasPhotoAdjustments(settings)) return;
			this.#previewSourceUrl = url;
			this.#previewSettings = { ...settings };
			if (!this.#previewAbort) {
				this.#previewAbort = new AbortController();
				this.#previewRenderer = createPhotoPreview(url, this.#previewAbort.signal);
			}
			if (!this.#previewRunning && this.#previewRenderer)
				void this.#renderPreview(this.#previewAbort, this.#previewRenderer);
		});
	}

	async #renderPreview(
		controller: AbortController,
		render: (settings: PhotoAdjustments) => Promise<Blob>
	): Promise<void> {
		this.#previewRunning = true;
		this.loading = true;
		try {
			while (this.#previewSettings && !controller.signal.aborted) {
				const settings = this.#previewSettings;
				this.#previewSettings = undefined;
				const blob = await render(settings);
				if (controller.signal.aborted) return;
				const nextUrl = URL.createObjectURL(blob);
				let displayed = false;
				try {
					const image = new Image();
					image.src = nextUrl;
					await image.decode();
					if (controller.signal.aborted) return;
					const previousUrl = this.previewUrl;
					this.previewImage = image;
					displayed = true;
					await tick();
					if (previousUrl) URL.revokeObjectURL(previousUrl);
				} finally {
					if (!displayed) URL.revokeObjectURL(nextUrl);
				}
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			this.#previewError = this.#errorMessage(error, 'photoProcessing.previewFailed');
			controller.abort();
			this.#previewAbort = null;
			this.#previewRenderer = undefined;
			this.#previewSettings = undefined;
			this.#previewRunning = false;
			this.loading = false;
		} finally {
			if (this.#previewAbort === controller) {
				this.#previewRunning = false;
				this.loading = false;
			}
		}
	}

	reportPreviewError(error: unknown): void {
		this.#previewError = this.#errorMessage(error, 'photoProcessing.previewFailed');
	}

	clearPreview(): void {
		this.#previewAbort?.abort();
		this.#previewAbort = null;
		this.#previewSourceUrl = undefined;
		this.#previewSettings = undefined;
		this.#previewRenderer = undefined;
		this.#previewRunning = false;
		if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
		this.previewImage = undefined;
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

	async download(): Promise<void> {
		const source = this.sourceUrl;
		if (!source || this.busy || this.downloading) return;
		const settings = { ...request.photoAdjustments };
		const format = request.outputFormat;
		this.downloading = true;
		this.#actionError = null;
		try {
			const blob = await processPhoto(source, settings, undefined, undefined, format);
			const outputFormat = photoOutputFormat(blob);
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			try {
				link.href = url;
				link.download = `photo.${outputFormat}`;
				document.body.append(link);
				link.click();
			} finally {
				link.remove();
				setTimeout(() => URL.revokeObjectURL(url), 60_000);
			}
		} catch (error) {
			this.#actionError = this.#errorMessage(error, 'photoProcessing.downloadFailed');
		} finally {
			this.downloading = false;
		}
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
		const overlayId = generationOverlay.start('generationOverlay.upscale', {
			kind: 'upscale',
			provider: 'archai'
		});
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
		const outputFormat = photoOutputFormat(blob);
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
