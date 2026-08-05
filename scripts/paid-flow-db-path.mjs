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

import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PAID_FLOW_PERSIST_ROOT = join(tmpdir(), 'cadbos-paid-flow-d1');
export const PAID_FLOW_PERSIST_PATH = join(PAID_FLOW_PERSIST_ROOT, 'v3');
