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
import {
	generationKinds,
	mediaAccessSchema,
	type AdminGenerationDetailResponse
} from '$lib/api/contract';
import { formSnapshotSchema } from '$lib/api/form-snapshot';

export const adminGenerationDetailResponseSchema = z.object({
	id: z.string().min(1),
	prompt: z.string(),
	translatedPrompt: z.string().nullable(),
	kind: z.enum(generationKinds),
	createdAt: z.number().int().nonnegative(),
	image: mediaAccessSchema.nullable(),
	source: mediaAccessSchema.nullable(),
	reference: mediaAccessSchema.nullable(),
	hasReference: z.boolean(),
	formSnapshot: formSnapshotSchema.nullable(),
	media: z.array(mediaAccessSchema),
	project: z.object({ title: z.string() }).nullable(),
	session: z.object({ title: z.string() }).nullable()
}) satisfies z.ZodType<AdminGenerationDetailResponse>;
