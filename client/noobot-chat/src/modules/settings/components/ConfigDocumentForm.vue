<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, watch } from "vue";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import {
  CONFIG_NAV_SEPARATOR,
  buildConfigNavTree,
  ensureConfigNavContainer,
  findConfigNavTrail,
  firstConfigNavPath,
  resolveConfigNavContainer,
} from "../state/configNavigation.js";
import { resolveConfigFieldLabel } from "../state/configLabels.js";
import ConfigSectionEditor from "./ConfigSectionEditor.vue";
import SettingsActionGroup from "./SettingsActionGroup.vue";
import SettingsPanelHeader from "./SettingsPanelHeader.vue";
import SettingsWorkspaceLayout from "./SettingsWorkspaceLayout.vue";
import SettingsWorkspacePanel from "./SettingsWorkspacePanel.vue";

const props = defineProps({
  document: { type: Object, required: true },
  declarations: { type: Object, default: null },
  activePath: { type: String, default: "" },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  filePath: { type: String, default: "" },
});

const emit = defineEmits(["select-path", "save"]);
const { translate } = useLocale();

const navTree = computed(() => buildConfigNavTree(props.document));
const trail = computed(() => findConfigNavTrail(navTree.value, props.activePath));
const activeNav = computed(() => trail.value[trail.value.length - 1] || null);
const activeContainer = computed(() =>
  activeNav.value ? resolveConfigNavContainer(props.document, trail.value) : undefined,
);
const activeDeclaration = computed(() =>
  activeNav.value ? resolveConfigNavContainer(props.declarations || {}, trail.value) : undefined,
);
const breadcrumb = computed(() =>
  trail.value.map((navNode) => resolveConfigFieldLabel(translate, navNode.key)),
);
const editorActions = computed(() => [
  {
    command: "save",
    label: translate("settings.save"),
    type: "primary",
    className: "primary-btn",
    loading: props.saving,
  },
]);

function treeLabel(navNode) {
  return resolveConfigFieldLabel(translate, navNode.key);
}

function handleNodeClick(navNode) {
  emit("select-path", navNode.path);
}

function openEntry(entryKey) {
  if (!activeNav.value) return;
  emit("select-path", `${activeNav.value.path}${CONFIG_NAV_SEPARATOR}${entryKey}`);
}

function handleBreadcrumb(index) {
  const navNode = trail.value[index];
  if (navNode) emit("select-path", navNode.path);
}

watch(
  [() => props.activePath, navTree],
  () => {
    if (!navTree.value.length) return;
    if (!trail.value.length) {
      emit("select-path", firstConfigNavPath(navTree.value));
      return;
    }
    ensureConfigNavContainer(props.document, trail.value);
  },
  { immediate: true },
);
</script>

<template>
  <SettingsWorkspaceLayout :loading="loading">
    <SettingsWorkspacePanel>
      <SettingsPanelHeader :title="translate('settings.configSections')" />
      <div class="panel-body noobot-workspace-body">
        <el-scrollbar class="tree-scroll">
          <el-tree
            :data="navTree"
            node-key="path"
            :current-node-key="activePath"
            :props="{ label: 'key', children: 'children' }"
            :expand-on-click-node="false"
            highlight-current
            class="custom-tree"
            @node-click="handleNodeClick"
          >
            <template #default="{ data }">
              <span class="tree-node">
                <span class="node-label">{{ treeLabel(data) }}</span>
                <span v-if="data.exists" class="node-dot" />
              </span>
            </template>
          </el-tree>
        </el-scrollbar>
      </div>
    </SettingsWorkspacePanel>

    <SettingsWorkspacePanel panel-class="workspace-editor">
      <SettingsPanelHeader>
        <template #left>
          <div class="file-info">
            <el-breadcrumb class="config-breadcrumb" separator="/">
              <el-breadcrumb-item v-for="(text, index) in breadcrumb" :key="index">
                <span class="crumb-link" @click="handleBreadcrumb(index)">{{ text }}</span>
              </el-breadcrumb-item>
            </el-breadcrumb>
          </div>
        </template>
        <template #right>
          <SettingsActionGroup :actions="editorActions" @command="emit('save')" />
        </template>
      </SettingsPanelHeader>
      <div class="panel-body noobot-workspace-body editor-body">
        <el-scrollbar v-if="activeNav" class="section-scroll">
          <div class="section-body">
            <p v-if="filePath" class="section-file">{{ filePath }}</p>
            <ConfigSectionEditor
              :node="activeNav.node"
              :container="activeContainer"
              :document="document"
              :declaration="activeDeclaration"
              @open-entry="openEntry"
            />
          </div>
        </el-scrollbar>
        <div v-else class="empty-tip">
          <p>{{ translate("settings.selectConfigSection") }}</p>
        </div>
      </div>
    </SettingsWorkspacePanel>
  </SettingsWorkspaceLayout>
</template>

<style scoped>
.tree-node {
  display: inline-flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  min-width: 0;
}

.node-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--noobot-radius-pill);
  background: var(--noobot-accent);
  flex-shrink: 0;
}

.config-breadcrumb {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.crumb-link {
  cursor: pointer;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-md);
}

.crumb-link:hover {
  color: var(--noobot-text-accent);
}

.section-scroll {
  height: 100%;
}

.section-body {
  padding: var(--noobot-space-lg) var(--noobot-space-xl);
}

.section-file {
  margin: 0 0 var(--noobot-space-md);
  font-family: var(--noobot-font-mono);
  font-size: var(--noobot-font-size-xs);
  color: var(--noobot-text-muted);
}
</style>
