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

<script lang="ts">
	import { t, ti } from '$lib/i18n/index.svelte';
	import TabStrip from '$lib/components/TabStrip.svelte';
	import { workspaceTabs } from '$lib/state/workspace-tabs.svelte';

	const projectId = $derived(workspaceTabs.activeTabId);
</script>

<TabStrip
	tabs={workspaceTabs.activeSessionTabs}
	activeId={workspaceTabs.activeTab.activeSessionTabId ?? ''}
	ariaLabel={t('workspace.sessionTabs.label')}
	untitledLabel={t('projects.detail.sessionUntitled')}
	closeLabel={(title) => ti('workspace.sessionTabs.close', { title })}
	onActivate={(id) => workspaceTabs.activateSession(projectId, id)}
	onClose={(id) => workspaceTabs.closeSession(projectId, id)}
/>
