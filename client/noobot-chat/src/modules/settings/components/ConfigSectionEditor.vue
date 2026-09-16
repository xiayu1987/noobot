<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { Delete, Plus } from "@element-plus/icons-vue";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { CONFIG_FORM_NODE_KIND } from "../state/configStructureContract.js";
import {
  configEntryNodes,
  configLeafFields,
  defaultValueForConfigNode,
  isConfigContainerNode,
  isConfigGroupNode,
} from "../state/configNavigation.js";
import { resolveConfigFieldLabel } from "../state/configLabels.js";
import ConfigFieldControl from "./ConfigFieldControl.vue";

const props = defineProps({
  node: { type: Object, required: true },
  container: { type: [Object, Array], default: null },
  document: { type: Object, default: null },
  declaration: { type: Object, default: null },
});

const emit = defineEmits(["open-entry", "changed"]);
const { translate } = useLocale();
const KIND = CONFIG_FORM_NODE_KIND;
const newEntryKey = ref("");

const isContainer = computed(() => isConfigContainerNode(props.node));
const isLeaf = computed(() => !isConfigGroupNode(props.node));
const leafFields = computed(() => configLeafFields(props.node));
const entries = computed(() => configEntryNodes(props.node, props.container));
const scalarEntries = computed(() => entries.value.filter((item) => !isConfigGroupNode(item.node)));
const groupEntries = computed(() => entries.value.filter((item) => isConfigGroupNode(item.node)));
const rawFieldNode = computed(() => ({ ...props.node, key: props.node.key }));

function addCollectionEntry() {
  const key = String(newEntryKey.value || "").trim();
  if (!key || !props.container) return;
  if (props.container[key] === undefined) {
    props.container[key] = defaultValueForConfigNode(props.node.entry);
  }
  newEntryKey.value = "";
  emit("changed");
}

function addArrayItem() {
  if (!Array.isArray(props.container)) return;
  props.container.push(defaultValueForConfigNode(props.node.item));
  emit("changed");
}

function removeEntry(key) {
  if (Array.isArray(props.container)) props.container.splice(Number(key), 1);
  else if (props.container) delete props.container[key];
  emit("changed");
}

function entryLabel(key) {
  return resolveConfigFieldLabel(translate, key);
}
</script>

<template>
  <div class="config-section-editor">
    <div v-if="isContainer" class="entry-toolbar">
      <el-input
        v-if="node.kind === KIND.COLLECTION"
        v-model="newEntryKey"
        size="small"
        class="entry-key-input"
        :placeholder="translate('settings.configEntryKey')"
        @keyup.enter="addCollectionEntry()"
      />
      <el-button
        size="small"
        :icon="Plus"
        class="noobot-action-btn noobot-flat-soft-btn"
        @click="node.kind === KIND.COLLECTION ? addCollectionEntry() : addArrayItem()"
      >
        {{ translate("settings.configAddEntry") }}
      </el-button>
    </div>

    <ConfigFieldControl
      v-if="isLeaf"
      :node="rawFieldNode"
      :container="container"
      :document="document"
      :declaration-container="declaration"
    />

    <div v-if="leafFields.length" class="field-list">
      <ConfigFieldControl
        v-for="field in leafFields"
        :key="field.path"
        :node="field"
        :container="container"
        :document="document"
        :declaration-container="declaration"
      />
    </div>

    <div v-if="scalarEntries.length" class="field-list">
      <div v-for="entry in scalarEntries" :key="String(entry.key)" class="scalar-entry">
        <ConfigFieldControl
          class="scalar-entry-field"
          :node="entry.node"
          :container="container"
          :document="document"
          :declaration-container="declaration"
        />
        <el-button
          class="icon-btn danger-text"
          size="small"
          text
          :icon="Delete"
          :title="translate('settings.configRemoveEntry')"
          :aria-label="translate('settings.configRemoveEntry')"
          @click="removeEntry(entry.key)"
        />
      </div>
    </div>

    <div v-if="groupEntries.length" class="entry-list">
      <div
        v-for="entry in groupEntries"
        :key="String(entry.key)"
        class="entry-row noobot-list-row"
        @click="emit('open-entry', entry.key)"
      >
        <span class="entry-name">{{ entryLabel(entry.key) }}</span>
        <el-button
          class="icon-btn danger-text"
          size="small"
          text
          :icon="Delete"
          :title="translate('settings.configRemoveEntry')"
          :aria-label="translate('settings.configRemoveEntry')"
          @click.stop="removeEntry(entry.key)"
        />
      </div>
    </div>

    <div
      v-if="!isLeaf && !leafFields.length && !entries.length"
      class="empty-tip list-empty-tip section-empty"
    >
      <p>{{ translate("settings.configSectionEmpty") }}</p>
    </div>
  </div>
</template>

<style scoped>
.config-section-editor {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-md);
}

.entry-toolbar {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
}

.entry-key-input {
  width: 200px;
}

.field-list {
  display: flex;
  flex-direction: column;
}

.scalar-entry {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
}

.scalar-entry-field {
  flex: 1;
  min-width: 0;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs);
}

.entry-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.entry-name {
  font-size: var(--noobot-font-size-md);
  color: var(--noobot-text-main);
  word-break: break-all;
}

.section-empty {
  padding: var(--noobot-space-xl) 0;
}
</style>
