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

import type { LayoutServerLoad } from './$types';
import { customWorkflowsAvailable } from '$lib/server/comfyui';

const PLAYWRIGHT_AVAILABILITY_HEADER = 'x-cadbos-test-custom-workflows';

export const load: LayoutServerLoad = async ({ platform, request }) => {
	const testAvailability = __CADBOS_PLAYWRIGHT_TEST__
		? request.headers.get(PLAYWRIGHT_AVAILABILITY_HEADER) !== 'unavailable'
		: null;
	return {
		customWorkflowsAvailable: testAvailability ?? (await customWorkflowsAvailable(platform))
	};
};
