<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { Document, Folder, Key } from "@element-plus/icons-vue";
import SettingsPanelHeader from "./SettingsPanelHeader.vue";
import SettingsWorkspacePanel from "./SettingsWorkspacePanel.vue";
import WorkspaceResourceToolbar from "./WorkspaceResourceToolbar.vue";
import WorkspaceParamTreeSection from "./WorkspaceParamTreeSection.vue";

const props = defineProps({
  activeResourceSection: { type: String, default: "directory" },
  tree: { type: Array, default: () => [] },
  allWorkspaceTree: { type: Array, default: () => [] },
  systemParamTreeData: { type: Array, default: () => [] },
  userParamTreeData: { type: Array, default: () => [] },
  loadingTree: { type: Boolean, default: false },
  loadingAllTree: { type: Boolean, default: false },
  loadingSystemParamCatalog: { type: Boolean, default: false },
  loadingUserParamCatalog: { type: Boolean, default: false },
  loadingFile: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  resetting: { type: Boolean, default: false },
  syncing: { type: Boolean, default: false },
  syncingAll: { type: Boolean, default: false },
  resettingAll: { type: Boolean, default: false },
  connected: { type: Boolean, default: false },
  isSuperAdmin: { type: Boolean, default: false },
  translate: { type: Function, required: true },
});

const emit = defineEmits([
  "update:activeResourceSection",
  "refresh",
  "sync-workspace",
  "reset-workspace",
  "sync-all-workspace",
  "reset-all-workspace",
  "open-file",
  "insert-param",
]);

const sectionValue = computed({
  get: () => props.activeResourceSection,
  set: (value) => emit("update:activeResourceSection", value),
});

const refreshLoading = computed(
  () =>
    props.loadingTree ||
    props.loadingAllTree ||
    props.loadingSystemParamCatalog ||
    props.loadingUserParamCatalog ||
    props.resetting ||
    props.syncingAll,
);

function sectionClass(name) {
  return {
    "resource-collapse-item--active": sectionValue.value === name,
    "resource-collapse-item--collapsed": !!sectionValue.value && sectionValue.value !== name,
  };
}
</script>

<template>
  <SettingsWorkspacePanel panel-class="workspace-tree">
    <SettingsPanelHeader :title="translate('settings.resources')">
      <template #right>
        <WorkspaceResourceToolbar
          :refresh-loading="refreshLoading"
          :connected="connected"
          :resetting="resetting"
          :syncing="syncing"
          :syncing-all="syncingAll"
          :translate="translate"
          @refresh="$emit('refresh')"
        />
      </template>
    </SettingsPanelHeader>
    <div class="panel-body noobot-workspace-body">
      <el-collapse v-model="sectionValue" accordion class="resource-collapse">
        <el-collapse-item
          name="directory"
          :title="translate('settings.directory')"
          class="resource-collapse-item"
          :class="sectionClass('directory')"
        >
          <div class="dir-inner-actions">
            <el-button
              class="dark-btn noobot-action-btn noobot-flat-soft-btn"
              size="small"
              :loading="syncing"
              :disabled="loadingTree || loadingFile || saving || resetting"
              :title="translate('settings.syncConfig')"
              @click="$emit('sync-workspace')"
            >
              {{ translate("settings.syncConfig") }}
            </el-button>
            <el-button
              class="danger-btn noobot-action-btn"
              size="small"
              :loading="resetting"
              :disabled="loadingTree || loadingFile || saving || syncing"
              :title="translate('settings.resetWorkspaceTitle')"
              @click="$emit('reset-workspace')"
            >
              {{ translate("settings.reset") }}
            </el-button>
          </div>
          <el-scrollbar class="tree-scroll">
            <el-tree
              :data="tree"
              node-key="path"
              :props="{ label: 'label', children: 'children' }"
              highlight-current
              class="custom-tree"
              @node-click="(data) => $emit('open-file', data, 'user')"
            >
              <template #default="{ data }">
                <span class="tree-node">
                  <el-icon class="node-icon">
                    <Folder v-if="data.type === 'dir'" />
                    <Document v-else />
                  </el-icon>
                  <span class="node-label">{{ data.label }}</span>
                </span>
              </template>
            </el-tree>
          </el-scrollbar>
        </el-collapse-item>
        <el-collapse-item
          v-if="isSuperAdmin"
          name="all-workspace"
          :title="translate('settings.allWorkspace')"
          class="resource-collapse-item"
          :class="sectionClass('all-workspace')"
        >
          <div class="dir-inner-actions">
            <el-button
              class="dark-btn noobot-action-btn noobot-flat-soft-btn"
              size="small"
              :loading="syncingAll"
              :disabled="loadingAllTree || loadingFile || saving || resetting || syncing || resettingAll"
              :title="translate('settings.syncAllConfig')"
              @click="$emit('sync-all-workspace')"
            >
              {{ translate("settings.syncConfig") }}
            </el-button>
            <el-button
              class="danger-btn noobot-action-btn"
              size="small"
              :loading="resettingAll"
              :disabled="loadingAllTree || loadingFile || saving || resetting || syncing || syncingAll"
              :title="translate('settings.resetAllWorkspaceKeepRuntime')"
              @click="$emit('reset-all-workspace')"
            >
              {{ translate("settings.reset") }}
            </el-button>
          </div>
          <el-scrollbar class="tree-scroll" v-loading="loadingAllTree" element-loading-background="var(--noobot-mask-bg)">
            <el-tree
              :data="allWorkspaceTree"
              node-key="path"
              :props="{ label: 'label', children: 'children' }"
              highlight-current
              class="custom-tree"
              @node-click="(data) => $emit('open-file', data, 'all')"
            >
              <template #default="{ data }">
                <span class="tree-node">
                  <el-icon class="node-icon">
                    <Folder v-if="data.type === 'dir'" />
                    <Document v-else />
                  </el-icon>
                  <span class="node-label">{{ data.label }}</span>
                </span>
              </template>
            </el-tree>
          </el-scrollbar>
        </el-collapse-item>
        <WorkspaceParamTreeSection
          name="system-params"
          :title="translate('settings.systemParams')"
          :item-class="sectionClass('system-params')"
          :tree-data="systemParamTreeData"
          :loading="loadingSystemParamCatalog"
          :translate="translate"
          @insert-param="(key) => $emit('insert-param', key)"
        />
        <el-collapse-item
          name="user-params"
          :title="translate('settings.userParams')"
          class="resource-collapse-item"
          :class="sectionClass('user-params')"
        >
          <el-scrollbar class="tree-scroll" v-loading="loadingUserParamCatalog" element-loading-background="var(--noobot-mask-bg)">
            <el-tree :data="userParamTreeData" node-key="key" :props="{ label: 'label', children: 'children' }" class="custom-tree param-tree">
              <template #default="{ data }">
                <span class="tree-node param-row" @dblclick.stop="$emit('insert-param', data.key)">
                  <el-icon class="node-icon"><Key /></el-icon>
                  <span class="node-label">{{ data.label }}</span>
                  <span class="param-desc" :title="data.description">{{ data.description || translate("settings.noDescription") }}</span>
                </span>
              </template>
            </el-tree>
            <div v-if="!userParamTreeData.length && !loadingUserParamCatalog" class="empty-tip left-empty">
              <p>{{ translate("settings.noParams") }}</p>
            </div>
          </el-scrollbar>
        </el-collapse-item>
      </el-collapse>
    </div>
  </SettingsWorkspacePanel>
</template>

<style scoped>
.dir-inner-actions {
  display: flex;
  gap: 8px;
  padding: 8px 10px 0 10px;
}

.resource-collapse {
  height: 100%;
  min-height: 0;
  border: none;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.resource-collapse :deep(.el-collapse-item__header) {
  height: 40px;
  line-height: 40px;
  padding: 0 12px;
  background: var(--noobot-panel-head-bg);
  color: var(--noobot-text-main);
  border-bottom: 1px solid var(--noobot-divider);
  font-size: var(--noobot-font-size-md);
  font-weight: 600;
}

.resource-collapse :deep(.el-collapse-item__header:hover) {
  background: var(--noobot-panel-muted);
}

.resource-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 1px solid var(--noobot-divider);
  background: color-mix(in srgb, var(--noobot-panel-bg) 92%, var(--noobot-surface-sidebar));
}

.resource-collapse :deep(.el-collapse-item__content) {
  padding: 0;
}

.resource-collapse :deep(.resource-collapse-item) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 0 0 auto;
}

.resource-collapse :deep(.resource-collapse-item--active) {
  flex: 1;
}

.resource-collapse :deep(.resource-collapse-item--active .el-collapse-item__wrap) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.resource-collapse :deep(.resource-collapse-item--active .el-collapse-item__content) {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.resource-collapse :deep(.resource-collapse-item--collapsed) {
  margin-top: auto;
}

.tree-node {
  width: 100%;
  min-width: 0;
}

.node-icon {
  color: var(--noobot-text-secondary);
}

.param-row {
  cursor: pointer;
}

.param-desc {
  margin-left: auto;
  color: var(--noobot-text-muted);
  font-size: var(--noobot-font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.left-empty {
  position: static;
  min-height: 80px;
}

.empty-tip :deep(.el-empty__description p) {
  color: var(--noobot-text-muted);
}

@media (max-width: 768px) {
  .resource-collapse {
    height: auto;
    min-height: auto;
  }

  .resource-collapse :deep(.resource-collapse-item--active .el-collapse-item__wrap),
  .resource-collapse :deep(.resource-collapse-item--active .el-collapse-item__content) {
    height: auto;
    min-height: auto;
    overflow: visible;
  }
}
</style>
