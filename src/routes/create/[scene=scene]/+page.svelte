<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate written
agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<!--
	This route only exists to register the URL and assert the default app title
	via <svelte:head> below — <svelte:head><title> compiles to an effect with no
	cleanup, so without this, navigating here from a page that set its own title
	(e.g. /expenses) would leave the browser tab showing that page's title
	forever. The actual UI is <Workspace /> in the root +layout.svelte, which
	stays mounted across mode/scene navigation instead of remounting.
-->

<script lang="ts">
	import { t } from '$lib/i18n/index.svelte';
</script>

<svelte:head>
	<title>{t('app.title')}</title>
</svelte:head>
