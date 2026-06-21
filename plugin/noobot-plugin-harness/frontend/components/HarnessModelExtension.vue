<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useHarnessLocale } from "../i18n";

const props = defineProps({
  modelOptions: { type: Array, default: () => [] },
  pluginModelConfig: { type: Object, default: () => ({}) },
  hasModelOptions: { type: Boolean, default: false },
  updatePluginModelConfig: { type: Function, default: null },
});

const HARNESS_MODEL_STEPS = [
  { key: "planning", label: "Planning" },
  { key: "guidance", label: "Guidance" },
  { key: "acceptance", label: "Acceptance" },
  { key: "default", label: "Default" },
];

const { translate } = useHarnessLocale();

function getHarnessStepModel(stepKey = "") {
  return String(props.pluginModelConfig?.harness?.stepModels?.[stepKey] || "").trim();
}

function getModelMetaText(modelItem = {}) {
  return [modelItem.alias && modelItem.alias !== modelItem.label ? modelItem.alias : "", modelItem.model]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" · ");
}

function onHarnessStepModelChange(stepKey = "", value = "") {
  const key = String(stepKey || "").trim();
  if (!key || typeof props.updatePluginModelConfig !== "function") return;
  const nextValue = String(value || "").trim();
  const currentConfig = props.pluginModelConfig && typeof props.pluginModelConfig === "object"
    ? props.pluginModelConfig
    : {};
  const currentStepModels = currentConfig?.harness?.stepModels && typeof currentConfig.harness.stepModels === "object"
    ? currentConfig.harness.stepModels
    : {};
  const nextStepModels = { ...currentStepModels };
  if (nextValue) nextStepModels[key] = nextValue;
  else delete nextStepModels[key];
  props.updatePluginModelConfig({
    ...currentConfig,
    harness: {
      ...(currentConfig.harness && typeof currentConfig.harness === "object" ? currentConfig.harness : {}),
      stepModels: nextStepModels,
    },
  });
}
</script>

<template>
  <div class="plugin-model-card">
    <div class="plugin-model-heading">
      <div class="plugin-model-title">{{ translate("modelExtension.title") }}</div>
      <p class="plugin-model-description">{{ translate("modelExtension.description") }}</p>
    </div>
    <div class="plugin-model-grid">
      <label
        v-for="stepItem in HARNESS_MODEL_STEPS"
        :key="stepItem.key"
        class="plugin-model-field"
      >
        <span class="plugin-model-label">{{ stepItem.label }}</span>
        <el-select
          :model-value="getHarnessStepModel(stepItem.key)"
          size="small"
          clearable
          :filterable="false"
          popper-class="noobot-composer-select-popper noobot-model-select-popper"
          :disabled="!hasModelOptions"
          :placeholder="translate('modelExtension.placeholder')"
          class="composer-select model-select noobot-model-select-control"
          @update:model-value="onHarnessStepModelChange(stepItem.key, $event)"
        >
          <el-option
            v-for="modelItem in modelOptions"
            :key="`${stepItem.key}-${modelItem.value}`"
            :label="modelItem.label"
            :value="modelItem.value"
          >
            <div class="model-option-content">
              <span class="model-option-label">{{ modelItem.label }}</span>
              <span v-if="getModelMetaText(modelItem)" class="model-option-meta">{{ getModelMetaText(modelItem) }}</span>
              <span v-if="modelItem.description" class="model-option-description">{{ modelItem.description }}</span>
            </div>
          </el-option>
        </el-select>
      </label>
    </div>
    <span v-if="!hasModelOptions" class="plugin-empty-text">{{ translate("modelExtension.empty") }}</span>
  </div>
</template>

<style scoped>
.plugin-model-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 18%, var(--noobot-panel-border, var(--el-border-color)));
  border-radius: 16px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--noobot-surface-sidebar, var(--el-bg-color)) 95%, var(--el-fill-color-light)),
      color-mix(in srgb, var(--noobot-surface-sidebar, var(--el-bg-color)) 88%, var(--el-color-primary))
    );
  box-shadow: 0 1px 0 color-mix(in srgb, var(--noobot-base-white, #ffffff) 42%, transparent) inset;
}

.plugin-model-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--noobot-text-strong, var(--el-text-color-primary));
}

.plugin-model-description {
  margin: 3px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
}

.plugin-model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.plugin-model-field {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  min-width: 0;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 64%, transparent);
  border-radius: 13px;
  background: color-mix(in srgb, var(--noobot-control-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay))) 88%, transparent);
}

.plugin-model-label {
  font-size: 12px;
  font-weight: 650;
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.model-select {
  width: 100%;
  min-width: 0;
}

.composer-select :deep(.el-select__wrapper) {
  min-height: 38px;
  height: 38px;
  box-sizing: border-box;
  border-radius: 12px;
  background: color-mix(in srgb, var(--noobot-control-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay))) 94%, var(--el-color-primary));
  border-color: color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 78%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 78%, transparent) inset,
    0 1px 0 color-mix(in srgb, var(--noobot-base-black, #000000) 5%, transparent);
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.composer-select :deep(.el-select__wrapper.is-focused),
.composer-select :deep(.el-select__wrapper:hover) {
  border-color: color-mix(in srgb, var(--el-color-primary) 50%, var(--noobot-panel-border, var(--el-border-color)));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--el-color-primary) 42%, transparent) inset,
    0 8px 20px color-mix(in srgb, var(--el-color-primary) 12%, transparent);
}

.composer-select :deep(.el-select__selected-item),
.composer-select :deep(.el-select__placeholder) {
  min-width: 0;
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.composer-select :deep(.el-select__placeholder.is-transparent) {
  color: var(--noobot-text-muted, var(--el-text-color-placeholder));
}

.model-option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}

.model-option-label {
  font-weight: 650;
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.model-option-meta,
.model-option-description,
.plugin-empty-text {
  font-size: 12px;
  line-height: 1.35;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
}

.model-option-description,
.plugin-empty-text {
  color: var(--noobot-text-muted, var(--el-text-color-secondary));
}

@media (max-width: 768px) {
  .plugin-model-card {
    padding: 12px;
  }

  .plugin-model-grid {
    grid-template-columns: 1fr;
  }

  .composer-select :deep(.el-select__wrapper) {
    min-height: 38px;
    height: 38px;
  }
}
</style>
