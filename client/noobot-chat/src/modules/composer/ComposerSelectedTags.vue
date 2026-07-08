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
      class="selected-connector-name selected-scenario-name noobot-inline-pill is-primary"
    >
      {{ translate("composer.botScenario") }}: {{ selectedScenarioLabel }}
    </span>
    <span
      v-for="(connectorName, connectorIndex) in selectedConnectorNames"
      :key="`${connectorName}-${connectorIndex}`"
      class="selected-connector-name noobot-inline-pill"
    >
      {{ connectorName }}
    </span>
    <span
      v-for="(pluginLabel, pluginIndex) in selectedPluginLabels"
      :key="`plugin-${pluginLabel}-${pluginIndex}`"
      class="selected-connector-name selected-plugin-name noobot-inline-pill is-plugin"
    >
      {{ pluginLabel }}
    </span>
    <span
      v-for="(uploadFile, uploadFileIndex) in uploadFiles"
      :key="`attachment-${uploadFile.name}-${uploadFileIndex}`"
      class="selected-connector-name selected-attachment-name noobot-inline-pill"
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
  color: var(--noobot-text-secondary, var(--noobot-text-secondary));
  padding: 4px 14px;
  font-size: 13px;
  font-weight: 500;
}

.selected-scenario-name {
  border-color: color-mix(in srgb, var(--el-color-primary) 28%, transparent);
}

.selected-plugin-name {
  border-color: color-mix(in srgb, var(--noobot-cyber-cyan, var(--noobot-base-blue-500)) 32%, transparent);
  background: color-mix(in srgb, var(--noobot-cyber-cyan, var(--noobot-base-blue-500)) 10%, transparent);
}

.selected-attachment-name {
  border-color: color-mix(in srgb, var(--noobot-text-muted, var(--noobot-text-muted)) 28%, transparent);
  background: color-mix(in srgb, var(--noobot-fill-soft, var(--noobot-fill-soft)) 78%, var(--noobot-base-blue-500, var(--noobot-base-blue-500)));
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
  color: var(--noobot-text-secondary, var(--noobot-text-secondary));
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
