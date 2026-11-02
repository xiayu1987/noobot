<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import SettingsPanelHeader from "./SettingsPanelHeader.vue";
import SettingsWorkspaceLayout from "./SettingsWorkspaceLayout.vue";
import SettingsWorkspacePanel from "./SettingsWorkspacePanel.vue";

defineProps({
  loading: { type: Boolean, default: false },
  treeTitle: { type: String, required: true },
  nodes: { type: Array, required: true },
  labelKey: { type: String, required: true },
  currentNodeKey: { type: String, default: undefined },
  expandOnClickNode: { type: Boolean, default: true },
  bodyClass: { type: String, default: "" },
});
const emit = defineEmits(["node-click"]);
</script>

<template>
  <SettingsWorkspaceLayout :loading="loading">
    <SettingsWorkspacePanel>
      <SettingsPanelHeader :title="treeTitle" />
      <div class="panel-body noobot-workspace-body">
        <slot name="tree-top" />
        <el-scrollbar class="tree-scroll">
          <el-tree
            :data="nodes"
            node-key="path"
            :current-node-key="currentNodeKey"
            :props="{ label: labelKey, children: 'children' }"
            :expand-on-click-node="expandOnClickNode"
            highlight-current
            class="custom-tree"
            @node-click="(node) => emit('node-click', node)"
          >
            <template #default="{ data }">
              <span class="tree-node">
                <slot name="node" :node="data" />
              </span>
            </template>
          </el-tree>
        </el-scrollbar>
      </div>
    </SettingsWorkspacePanel>

    <SettingsWorkspacePanel>
      <SettingsPanelHeader>
        <template #left>
          <div class="file-info"><slot name="editor-left" /></div>
        </template>
        <template #right>
          <slot name="editor-right" />
        </template>
      </SettingsPanelHeader>
      <div class="panel-body noobot-workspace-body" :class="bodyClass">
        <slot />
      </div>
    </SettingsWorkspacePanel>
  </SettingsWorkspaceLayout>
</template>
