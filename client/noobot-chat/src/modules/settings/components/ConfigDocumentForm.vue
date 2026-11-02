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
import SettingsTreeWorkspace from "./SettingsTreeWorkspace.vue";

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
  <SettingsTreeWorkspace
    :loading="loading"
    :tree-title="translate('settings.configSections')"
    :nodes="navTree"
    label-key="key"
    :current-node-key="activePath"
    :expand-on-click-node="false"
    body-class="editor-body"
    @node-click="handleNodeClick"
  >
    <template #node="{ node }">
      <span class="node-label">{{ treeLabel(node) }}</span>
      <span v-if="node.exists" class="node-dot" />
    </template>
    <template #editor-left>
      <el-breadcrumb class="config-breadcrumb" separator="/">
        <el-breadcrumb-item v-for="(text, index) in breadcrumb" :key="index">
          <span class="crumb-link" @click="handleBreadcrumb(index)">{{ text }}</span>
        </el-breadcrumb-item>
      </el-breadcrumb>
    </template>
    <template #editor-right>
      <SettingsActionGroup :actions="editorActions" @command="emit('save')" />
    </template>
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
  </SettingsTreeWorkspace>
</template>

<style scoped>
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
  color: var(--noobot-text-secondary);
}
</style>
