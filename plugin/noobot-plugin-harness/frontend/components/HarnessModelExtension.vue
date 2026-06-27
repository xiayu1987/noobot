<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
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
  { key: "acceptance", label: "Planning Acceptance" },
  { key: "default", label: "Default" },
];

const { translate } = useHarnessLocale();

function getHarnessStepModel(stepKey = "") {
  return String(props.pluginModelConfig?.harness?.stepModels?.[stepKey] || "").trim();
}

function normalizeGuidanceAnalysisIntensity(value = 10) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 10;
  return Math.min(10, Math.max(1, Math.round(num)));
}

function mapGuidanceAnalysisIntensityToTurnsThreshold(value = 10) {
  return 11 - normalizeGuidanceAnalysisIntensity(value);
}

function mapGuidanceAnalysisTurnsThresholdToIntensity(value = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 10;
  const turnsThreshold = Math.min(10, Math.max(1, Math.round(num)));
  return 11 - turnsThreshold;
}

function getGuidanceAnalysisTurnsThreshold() {
  return mapGuidanceAnalysisIntensityToTurnsThreshold(getGuidanceAnalysisIntensity());
}

function getGuidanceAnalysisIntensity() {
  return mapGuidanceAnalysisTurnsThresholdToIntensity(
    props.pluginModelConfig?.harness?.guidance?.analysis?.turnsThreshold,
  );
}

const guidanceAnalysisIntensity = computed({
  get() {
    return getGuidanceAnalysisIntensity();
  },
  set(value) {
    onGuidanceAnalysisIntensityChange(value);
  },
});

function getModelMetaText(modelItem = {}) {
  return [modelItem.alias && modelItem.alias !== modelItem.label ? modelItem.alias : "", modelItem.model]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" · ");
}

function onHarnessStepModelChange(stepKey = "", value = "") {
  const key = String(stepKey || "").trim();
  if (!key || typeof props.updatePluginModelConfig !== "function") return;
  if (isHarnessStepModelDisabled(key)) return;
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

function isHarnessCapabilityEnabled(capabilityKey = "") {
  const key = String(capabilityKey || "").trim();
  if (!key) return true;
  return props.pluginModelConfig?.harness?.capabilityProfile?.[key]?.enabled !== false;
}

function onHarnessCapabilityEnabledChange(capabilityKey = "", value = true) {
  const key = String(capabilityKey || "").trim();
  if (!key || typeof props.updatePluginModelConfig !== "function") return;
  if (key === "guidance") return;
  const enabled = value !== false;
  const currentConfig = props.pluginModelConfig && typeof props.pluginModelConfig === "object"
    ? props.pluginModelConfig
    : {};
  const currentHarness = currentConfig.harness && typeof currentConfig.harness === "object"
    ? currentConfig.harness
    : {};
  const currentProfile = currentHarness.capabilityProfile && typeof currentHarness.capabilityProfile === "object"
    ? currentHarness.capabilityProfile
    : {};
  const nextProfile = { ...currentProfile };
  const nextCapability = nextProfile[key] && typeof nextProfile[key] === "object"
    ? { ...nextProfile[key] }
    : {};
  if (enabled) {
    if (Object.prototype.hasOwnProperty.call(nextCapability, "enabled")) delete nextCapability.enabled;
  } else {
    nextCapability.enabled = false;
  }
  if (Object.keys(nextCapability).length) nextProfile[key] = nextCapability;
  else delete nextProfile[key];
  props.updatePluginModelConfig({
    ...currentConfig,
    harness: {
      ...currentHarness,
      capabilityProfile: nextProfile,
    },
  });
}

function onGuidanceAnalysisIntensityChange(value = 10) {
  if (typeof props.updatePluginModelConfig !== "function") return;
  const turnsThreshold = mapGuidanceAnalysisIntensityToTurnsThreshold(value);
  const currentConfig = props.pluginModelConfig && typeof props.pluginModelConfig === "object"
    ? props.pluginModelConfig
    : {};
  const currentHarness = currentConfig.harness && typeof currentConfig.harness === "object"
    ? currentConfig.harness
    : {};
  const currentGuidance = currentHarness.guidance && typeof currentHarness.guidance === "object"
    ? currentHarness.guidance
    : {};
  const currentAnalysis = currentGuidance.analysis && typeof currentGuidance.analysis === "object"
    ? currentGuidance.analysis
    : {};
  props.updatePluginModelConfig({
    ...currentConfig,
    harness: {
      ...currentHarness,
      guidance: {
        ...currentGuidance,
        analysis: {
          ...currentAnalysis,
          turnsThreshold,
        },
      },
    },
  });
}

function canToggleHarnessCapability(stepKey = "") {
  const key = String(stepKey || "").trim();
  return key && key !== "default" && key !== "guidance";
}

function isHarnessStepModelDisabled(stepKey = "") {
  const key = String(stepKey || "").trim();
  if (!props.hasModelOptions) return true;
  return canToggleHarnessCapability(key) && !isHarnessCapabilityEnabled(key);
}
</script>

<template>
  <div class="plugin-model-card">
    <div class="plugin-model-heading">
      <div class="plugin-model-title">{{ translate("modelExtension.title") }}</div>
      <p class="plugin-model-description">{{ translate("modelExtension.description") }}</p>
    </div>
    <div class="plugin-model-grid">
      <div
        v-for="stepItem in HARNESS_MODEL_STEPS"
        :key="stepItem.key"
        class="plugin-model-field"
      >
        <span class="plugin-model-label">{{ stepItem.label }}</span>
        <el-radio-group
          v-if="canToggleHarnessCapability(stepItem.key)"
          :model-value="isHarnessCapabilityEnabled(stepItem.key)"
          size="small"
          class="plugin-capability-toggle"
          @update:model-value="onHarnessCapabilityEnabledChange(stepItem.key, $event)"
        >
          <el-radio-button :value="true">{{ translate("modelExtension.enabled") }}</el-radio-button>
          <el-radio-button :value="false">{{ translate("modelExtension.disabled") }}</el-radio-button>
        </el-radio-group>
        <div
          v-else-if="stepItem.key === 'guidance'"
          class="plugin-guidance-analysis-control"
          @click.stop
          @mousedown.stop
          @pointerdown.stop
          @touchstart.stop
        >
          <span class="plugin-guidance-analysis-title">
            {{ translate("modelExtension.guidanceAnalysisIntensity") }}
            <strong>{{ getGuidanceAnalysisIntensity() }}</strong>
          </span>
          <el-slider
            v-model="guidanceAnalysisIntensity"
            :min="1"
            :max="10"
            :step="1"
            show-stops
            size="small"
            @click.stop
            @mousedown.stop
            @pointerdown.stop
            @touchstart.stop
          />
        </div>
        <el-select
          :model-value="getHarnessStepModel(stepItem.key)"
          size="small"
          clearable
          :filterable="false"
          popper-class="noobot-composer-select-popper noobot-model-select-popper"
          :disabled="isHarnessStepModelDisabled(stepItem.key)"
          :placeholder="stepItem.key === 'acceptance' && !isHarnessCapabilityEnabled(stepItem.key)
            ? translate('modelExtension.acceptanceModelDisabled')
            : translate('modelExtension.placeholder')"
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
      </div>
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

.plugin-capability-toggle {
  width: 100%;
  height: 28px;
  min-height: 28px;
  align-items: stretch;
  box-sizing: border-box;
}

.plugin-capability-toggle :deep(.el-radio-button) {
  flex: 1 1 0;
}

.plugin-capability-toggle :deep(.el-radio-button__inner) {
  width: 100%;
  height: 28px;
  line-height: 26px;
  padding-top: 0;
  padding-bottom: 0;
  padding-left: 8px;
  padding-right: 8px;
  box-sizing: border-box;
  font-size: 12px;
}

.plugin-fixed-text {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  height: 28px;
  padding: 0 9px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 22%, var(--noobot-panel-border, var(--el-border-color)));
  border-radius: 8px;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  background: color-mix(in srgb, var(--el-color-primary) 6%, var(--noobot-control-bg, var(--el-bg-color)));
  font-size: 12px;
}

.plugin-guidance-analysis-control {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 28px;
  min-height: 28px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 22%, var(--noobot-panel-border, var(--el-border-color)));
  border-radius: 8px;
  background: color-mix(in srgb, var(--el-color-primary) 6%, var(--noobot-control-bg, var(--el-bg-color)));
}

.plugin-guidance-analysis-title {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  max-width: 42%;
  font-size: 12px;
  line-height: 1.2;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  white-space: nowrap;
}

.plugin-guidance-analysis-title strong {
  color: var(--el-color-primary);
  font-size: 13px;
  font-weight: 700;
}

.plugin-guidance-analysis-control :deep(.el-slider) {
  --el-slider-height: 4px;
  --el-slider-button-size: 13px;
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  height: 28px;
  margin: 0;
  padding: 0 7px;
  box-sizing: border-box;
}

.plugin-guidance-analysis-control :deep(.el-slider__runway) {
  margin: 12px 0;
}

.plugin-guidance-analysis-control :deep(.el-slider__stop) {
  width: 3px;
  height: 3px;
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
