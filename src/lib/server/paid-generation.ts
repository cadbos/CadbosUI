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

import type { D1Database } from '@cloudflare/workers-types';
import type { RenderResponse } from '$lib/api/contract';
import { assertGenerationAllowed } from '$lib/server/billing';
import { isExplicitGenerationFailure } from '$lib/server/generation';
import {
	confirmGenerationOperation,
	createGenerationOperation,
	failGenerationOperation,
	finalizeGenerationOperation,
	reconcileGenerationOperations,
	type CreateGenerationOperationInput
} from '$lib/server/generations';

export type PaidGenerationResult =
	| { allowed: false; reason: 'not_approved' | 'insufficient_credit' }
	| { allowed: true; response: RenderResponse };

export async function runPaidGeneration(
	db: D1Database,
	userId: string,
	input: CreateGenerationOperationInput,
	generate: () => Promise<RenderResponse>
): Promise<PaidGenerationResult> {
	await reconcileGenerationOperations(db, userId);
	const access = await assertGenerationAllowed(db, userId);
	if (!access.allowed) return access;

	const operationId = await createGenerationOperation(db, userId, input);
	let providerResult: RenderResponse;
	try {
		providerResult = await generate();
	} catch (error) {
		if (isExplicitGenerationFailure(error)) {
			try {
				await failGenerationOperation(db, userId, operationId);
			} catch (persistenceError) {
				console.error('generation failure state persistence failed:', persistenceError);
			}
		}
		throw error;
	}

	await confirmGenerationOperation(db, userId, operationId, providerResult);
	const completed = await finalizeGenerationOperation(db, userId, operationId);
	return {
		allowed: true,
		response: {
			outputUrl: completed.outputUrl,
			cost: completed.cost,
			balance: completed.balanceAfter
		}
	};
}
