<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useWorkflowLocale } from "../i18n/index.js";
import { text } from "@noobot/shared/value";

const props = defineProps({
  modelOptions: { type: Array, default: () => [] },
  hasModelOptions: { type: Boolean, default: false },
  pluginContext: { type: Object, required: true },
});
const pluginConfig = computed(() => props.pluginContext.config.get());

const { translate } = useWorkflowLocale();

function getWorkflowSemanticModel() {
  return text(pluginConfig.value?.semanticModel);
}

function onWorkflowSemanticModelChange(value = "") {
  const nextValue = text(value);
  props.pluginContext.config.patch({ semanticModel: nextValue });
}
</script>

<template>
  <div class="plugin-model-card noobot-panel-card">
    <div class="plugin-model-heading">
      <div class="plugin-model-title">{{ translate("modelExtension.title") }}</div>
      <p class="plugin-model-description">{{ translate("modelExtension.description") }}</p>
    </div>
    <label class="plugin-model-field workflow-model-field">
      <span class="plugin-model-label">{{ translate("modelExtension.field") }}</span>
      <el-select
        :model-value="getWorkflowSemanticModel()"
        size="small"
        clearable
        :filterable="false"
        popper-class="noobot-select-popper noobot-model-select-popper"
        :disabled="!hasModelOptions"
        :placeholder="translate('modelExtension.placeholder')"
        class="composer-select model-select noobot-model-select-control"
        @update:model-value="onWorkflowSemanticModelChange"
      >
        <el-option
          v-for="modelItem in modelOptions"
          :key="`workflow-${modelItem.alias}`"
          :label="modelItem.alias"
          :value="modelItem.alias"
        >
          <div class="model-option-content">
            <span class="model-option-label">{{ modelItem.alias }}</span>
            <span v-if="modelItem.model" class="model-option-meta">{{ modelItem.model }}</span>
            <span v-if="modelItem.description" class="model-option-description">{{
              modelItem.description
            }}</span>
          </div>
        </el-option>
      </el-select>
    </label>
    <span v-if="!hasModelOptions" class="plugin-empty-text">{{
      translate("modelExtension.empty")
    }}</span>
  </div>
</template>

<style scoped>
.plugin-model-card {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-lg);
  padding: var(--noobot-space-xl);
}

.plugin-model-title {
  font-size: var(--noobot-font-size-sm);
  font-weight: var(--noobot-font-weight-bold);
  color: var(--noobot-text-strong);
}

.plugin-model-description {
  margin: var(--noobot-space-3xs) 0 0;
  font-size: var(--noobot-font-size-xs);
  line-height: var(--noobot-line-height-comfortable);
  color: var(--noobot-text-secondary);
}

.plugin-model-field {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--noobot-space-xs);
  min-width: 0;
  padding: var(--noobot-space-md);
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border) 64%, transparent);
  border-radius: var(--noobot-radius-md);
  background: color-mix(in srgb, var(--noobot-control-bg) 88%, transparent);
}

.plugin-model-label {
  font-size: var(--noobot-font-size-xs);
  font-weight: var(--noobot-font-weight-semibold);
  color: var(--noobot-text-main);
}

.model-select {
  width: 100%;
  min-width: 0;
}

.model-option-content {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-3xs);
  padding: var(--noobot-space-2xs) 0;
}

.model-option-label {
  font-weight: var(--noobot-font-weight-semibold);
  color: var(--noobot-text-main);
}

.model-option-meta,
.model-option-description,
.plugin-empty-text {
  font-size: var(--noobot-font-size-xs);
  line-height: var(--noobot-line-height-balanced);
  color: var(--noobot-text-secondary);
}

@media (max-width: 768px) {
  .plugin-model-card {
    padding: var(--noobot-space-lg);
  }
}
</style>
