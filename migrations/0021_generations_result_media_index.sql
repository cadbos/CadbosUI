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

-- Looking a media row up as some generation's result had no index: the
-- Resources gallery asks it for every source image ("was this photo itself a
-- generation's output?") and deleteGeneratedImage asks it before removing a
-- media row. Neither is scoped to a user, so each probe scanned the whole
-- generations table.
CREATE INDEX generations_result_media ON generations (result_media_id);
