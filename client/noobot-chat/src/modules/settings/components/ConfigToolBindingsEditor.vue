<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import { resolveToolBindingSettings } from "@noobot/agent-config-protocol";
import { TOOL_BINDING_NAME_MAX_LENGTH } from "@noobot/model-protocol";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { resolveConfigFieldLabel } from "../state/configLabels.js";

const props = defineProps({
  bindings: { type: Object, required: true },
  settings: { type: Object, default: null },
});
const { translate } = useLocale();
const selectedTool = ref("");
const entries = computed(() => Object.keys(props.bindings));
const availableTools = computed(() => {
  const configured = new Set(entries.value);
  return (props.settings?.toolIds || []).filter((id) => !configured.has(id));
});
const validationError = computed(() => {
  if (!props.settings) return translate("settings.toolBindingsUnavailable");
  try {
    resolveToolBindingSettings(props.settings, props.bindings);
    return "";
  } catch (error) {
    return error.message;
  }
});

function inheritedName(id) {
  return props.settings?.bindings?.[id]?.bindingName ?? id;
}

function toolLabel(id) {
  const label = resolveConfigFieldLabel(translate, id);
  return label === id ? id : `${label} (${id})`;
}

function addTool() {
  const id = selectedTool.value;
  if (!availableTools.value.includes(id)) return;
  props.bindings[id] = { bindingName: inheritedName(id) };
  selectedTool.value = "";
}

function setName(id, bindingName) {
  props.bindings[id] = { bindingName };
}

function resetTool(id) {
  delete props.bindings[id];
}
</script>

<template>
  <div class="tool-bindings-editor">
    <p class="binding-hint">{{ translate("settings.toolBindingsHint") }}</p>
    <div class="binding-toolbar">
      <el-select
        v-model="selectedTool"
        filterable
        clearable
        class="binding-select"
        popper-class="noobot-select-popper"
        :disabled="!settings || availableTools.length === 0"
        :placeholder="translate('settings.toolBindingsSelect')"
        :aria-label="translate('settings.toolBindingsSelect')"
      >
        <el-option v-for="id in availableTools" :key="id" :value="id" :label="toolLabel(id)" />
      </el-select>
      <el-button
        :disabled="!selectedTool"
        class="noobot-action-btn noobot-flat-soft-btn"
        @click="addTool"
      >
        {{ translate("settings.configAddEntry") }}
      </el-button>
    </div>
    <div v-for="id in entries" :key="id" class="binding-row">
      <label class="binding-label" :for="`tool-binding-${id}`">{{ toolLabel(id) }}</label>
      <div class="binding-controls">
        <el-input
          :id="`tool-binding-${id}`"
          :model-value="bindings[id]?.bindingName"
          :maxlength="TOOL_BINDING_NAME_MAX_LENGTH"
          :placeholder="inheritedName(id)"
          :aria-label="toolLabel(id)"
          class="binding-input"
          @update:model-value="setName(id, $event)"
        />
        <el-button text class="noobot-action-btn noobot-flat-soft-btn" @click="resetTool(id)">
          {{ translate("settings.toolBindingsReset") }}
        </el-button>
      </div>
      <span class="binding-hint">
        {{ translate("settings.toolBindingsInherited", { name: inheritedName(id) }) }}
      </span>
    </div>
    <p v-if="validationError" class="binding-error" role="alert">{{ validationError }}</p>
  </div>
</template>

<style scoped>
.tool-bindings-editor,
.binding-row {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs);
}

.tool-bindings-editor {
  gap: var(--noobot-space-md);
}

.binding-toolbar,
.binding-controls {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-sm);
}

.binding-select,
.binding-input {
  flex: 1;
  min-width: 0;
}

.binding-label {
  color: var(--noobot-text-main);
  font-size: var(--noobot-font-size-md);
}

.binding-hint {
  margin: 0;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-xs);
}

.binding-error {
  margin: 0;
  color: var(--noobot-status-error);
  font-size: var(--noobot-font-size-sm);
}
</style>
