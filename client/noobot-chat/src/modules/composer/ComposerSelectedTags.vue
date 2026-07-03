<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { Close } from "@element-plus/icons-vue";
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  selectedConnectorNames: { type: Array, default: () => [] },
  selectedScenarioLabel: { type: String, default: "" },
  selectedPluginLabels: { type: Array, default: () => [] },
  uploadFiles: { type: Array, default: () => [] },
});

const { translate } = useLocale();
const emit = defineEmits(["remove-upload"]);

function onRemoveUpload(uploadFileIndex) {
  emit("remove-upload", uploadFileIndex);
}
</script>

<template>
  <div
    v-if="selectedConnectorNames.length || selectedScenarioLabel || selectedPluginLabels.length || uploadFiles.length"
    class="selected-connectors-row"
  >
    <span
      v-if="selectedScenarioLabel"
      class="selected-connector-name selected-scenario-name"
    >
      {{ translate("composer.botScenario") }}: {{ selectedScenarioLabel }}
    </span>
    <span
      v-for="(connectorName, connectorIndex) in selectedConnectorNames"
      :key="`${connectorName}-${connectorIndex}`"
      class="selected-connector-name"
    >
      {{ connectorName }}
    </span>
    <span
      v-for="(pluginLabel, pluginIndex) in selectedPluginLabels"
      :key="`plugin-${pluginLabel}-${pluginIndex}`"
      class="selected-connector-name selected-plugin-name"
    >
      {{ pluginLabel }}
    </span>
    <span
      v-for="(uploadFile, uploadFileIndex) in uploadFiles"
      :key="`attachment-${uploadFile.name}-${uploadFileIndex}`"
      class="selected-connector-name selected-attachment-name"
      :title="uploadFile.name"
    >
      <span class="selected-attachment-text">{{ uploadFile.name }}</span>
      <button
        type="button"
        class="selected-attachment-remove-btn noobot-flat-icon-btn"
        :title="translate('composer.removeAttachment', { name: uploadFile.name || '' })"
        :aria-label="translate('composer.removeAttachment', { name: uploadFile.name || '' })"
        @click.stop="onRemoveUpload(uploadFileIndex)"
      >
        <el-icon><Close /></el-icon>
      </button>
    </span>
  </div>
</template>

<style scoped>
.selected-connectors-row {
  max-width: 800px;
  margin: 0 auto 12px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.selected-connector-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--noobot-fill-soft, #f4f4f5);
  color: var(--noobot-text-secondary, #52525b);
  border: 1px solid transparent;
  border-radius: 20px;
  padding: 4px 14px;
  font-size: 13px;
  font-weight: 500;
  transition: background-color 0.2s ease;
}

.selected-connector-name:hover {
  background: var(--noobot-fill-hover, #e4e4e7);
}

.selected-scenario-name {
  border-color: rgba(59, 130, 246, 0.25);
}

.selected-plugin-name {
  border-color: rgba(14, 165, 233, 0.28);
  background: color-mix(in srgb, var(--noobot-cyber-cyan, #0ea5e9) 10%, transparent);
}

.selected-attachment-name {
  border-color: rgba(113, 113, 122, 0.24);
  background: color-mix(in srgb, var(--noobot-fill-soft, #f4f4f5) 78%, var(--noobot-base-blue-500, #3b82f6));
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-right: 6px;
}

.selected-attachment-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.selected-attachment-remove-btn {
  width: 20px;
  height: 20px;
  min-width: 20px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--noobot-text-secondary, #52525b);
  background: transparent;
  cursor: pointer;
  flex: 0 0 auto;
}

.selected-attachment-remove-btn:hover,
.selected-attachment-remove-btn:focus-visible {
  color: var(--el-color-danger);
  background: color-mix(in srgb, var(--el-color-danger) 10%, transparent);
  outline: none;
}

@media (max-width: 768px) {
  .selected-connectors-row {
    margin-bottom: 8px;
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: none;
  }

  .selected-connector-name {
    max-width: 168px;
    flex: 0 0 auto;
  }

  .selected-attachment-remove-btn {
    width: 24px;
    height: 24px;
    min-width: 24px;
  }
}
</style>
