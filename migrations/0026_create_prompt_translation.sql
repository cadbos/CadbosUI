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

-- The English translation a Create render (interior/exterior) sent archAI in
-- place of the user's own prompt. Create translates a Russian prompt through
-- Workers AI before the call (src/lib/server/prompt-translation.ts); `prompt`
-- keeps the user's text. NULL when archAI received `prompt` as written: it
-- needed no translation, translation failed, or no prompt was sent — so what
-- archAI received is COALESCE(translated_prompt, prompt). Also NULL for every
-- other kind and for rows written before this column existed.
ALTER TABLE generations ADD COLUMN translated_prompt TEXT;
