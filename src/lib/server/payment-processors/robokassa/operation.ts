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

import { RobokassaApiError, RobokassaError, type OperationStateResponse } from '@robokassa/sdk';
import { z } from 'zod';

import { resolveSdk, type RobokassaSettings } from './sdk';

const scalar = z.union([z.string(), z.number()]).transform(String);
const resultSchema = z.object({
	Code: z.number().int().nonnegative(),
	Description: z.string().optional()
});
const operationSchema = z.object({
	Result: resultSchema,
	State: z.object({
		Code: z.number().int().nonnegative(),
		RequestDate: z.string().optional(),
		StateDate: z.string().optional()
	}),
	Info: z
		.object({
			IncCurrLabel: scalar.optional(),
			IncSum: scalar.optional(),
			IncAccount: scalar.optional(),
			PaymentMethod: z
				.object({ Code: scalar.optional(), Description: scalar.optional() })
				.optional(),
			OutCurrLabel: scalar.optional(),
			OutSum: scalar.optional(),
			OpKey: scalar.optional(),
			BankCardRRN: scalar.optional()
		})
		.optional(),
	UserFields: z.record(z.string(), z.unknown()).optional()
});

export type RobokassaOperation =
	| { status: 'not-quoted' }
	| { status: 'unavailable-for-test' }
	| { status: 'not-found' }
	| { status: 'available'; details: z.infer<typeof operationSchema> };

export async function getOperationDetails(
	platform: App.Platform | undefined,
	fetcher: typeof fetch,
	invId: number,
	settings: RobokassaSettings
): Promise<RobokassaOperation> {
	const { client } = resolveSdk(platform, settings, fetcher);
	let operation: OperationStateResponse;
	try {
		operation = await client.webService.opState(invId);
	} catch (error) {
		throw new RobokassaError(
			error instanceof RobokassaError ? error.code : 'NETWORK_ERROR',
			'Robokassa operation lookup failed',
			{
				operation: 'webService.opState',
				...(error instanceof RobokassaError && error.statusCode !== undefined
					? { statusCode: error.statusCode }
					: {})
			}
		);
	}
	const result = resultSchema.safeParse(operation.Result);
	if (!result.success) {
		throw new RobokassaError('PARSE_ERROR', 'Robokassa returned an invalid operation result', {
			operation: 'webService.opState'
		});
	}
	if (result.data.Code === 3) return { status: 'not-found' };
	if (result.data.Code !== 0) {
		throw new RobokassaApiError(
			`Robokassa operation lookup failed (result code ${result.data.Code})`,
			{
				operation: 'webService.opState'
			}
		);
	}
	const details = operationSchema.safeParse(operation);
	if (!details.success) {
		throw new RobokassaError('PARSE_ERROR', 'Robokassa returned invalid operation details', {
			operation: 'webService.opState'
		});
	}
	return { status: 'available', details: details.data };
}
