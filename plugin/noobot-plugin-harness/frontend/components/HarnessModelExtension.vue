<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
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

const TEXT = Object.freeze({
  title: "Harness 插件",
  description: "为 planning / guidance / acceptance 等非主流程步骤单独指定模型。",
  placeholder: "使用主流程/默认模型",
  empty: "暂无可用于对话的启用模型",
});

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
      <div class="plugin-model-title">{{ TEXT.title }}</div>
      <p class="plugin-model-description">{{ TEXT.description }}</p>
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
          filterable
          :disabled="!hasModelOptions"
          :placeholder="TEXT.placeholder"
          class="model-select"
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
    <span v-if="!hasModelOptions" class="plugin-empty-text">{{ TEXT.empty }}</span>
  </div>
</template>

<style scoped>
.plugin-model-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 74%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--noobot-surface-sidebar, var(--el-bg-color)) 90%, var(--el-fill-color-light));
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
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px 12px;
}

.plugin-model-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.plugin-model-label {
  min-width: 86px;
  font-size: 12px;
  font-weight: 650;
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.model-select {
  width: min(260px, 100%);
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
  .plugin-model-field {
    align-items: flex-start;
    flex-direction: column;
  }

  .model-select {
    width: 100%;
  }
}
</style>
