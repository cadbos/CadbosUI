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
	import { SCRATCH_TAB_ID, workspaceTabs } from '$lib/state/workspace-tabs.svelte';

	// `renamable` is presentation-only — not part of WorkspaceTab's domain
	// shape — so it's mapped in here rather than stored on the tab itself.
	const tabItems = $derived(
		workspaceTabs.tabs.map((tab) => ({
			id: tab.id,
			title: tab.title,
			renamable: tab.id !== SCRATCH_TAB_ID
		}))
	);
</script>

<TabStrip
	tabs={tabItems}
	activeId={workspaceTabs.activeTabId}
	ariaLabel={t('workspace.tabs.label')}
	untitledLabel={t('workspace.tabs.untitled')}
	closeLabel={(title) => ti('workspace.tabs.close', { title })}
	scrollPrevLabel={t('workspace.tabs.scrollPrev')}
	scrollNextLabel={t('workspace.tabs.scrollNext')}
	renameLabel={(title) => ti('workspace.tabs.rename', { title })}
	renameFailedLabel={t('workspace.tabs.renameFailed')}
	onActivate={(id) => workspaceTabs.activate(id)}
	onClose={(id) => workspaceTabs.close(id)}
	onRename={(id, title) => workspaceTabs.renameProject(id, title)}
/>
