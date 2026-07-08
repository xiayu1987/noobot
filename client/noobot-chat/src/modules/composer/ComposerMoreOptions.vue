<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useLocale } from "../../shared/i18n/useLocale";
import {
  resolveComposerModelExtensionProps,
  resolveComposerModelExtensionRenderers,
} from "../../plugins/frontend-plugin-registry";

const props = defineProps({
  allowUserInteraction: { type: Boolean, default: true },
  forceTool: { type: Boolean, default: false },
  streamOutput: { type: Boolean, default: true },
  botScenario: { type: String, default: "" },
  normalizedScenarioOptions: { type: Array, default: () => [] },
  selectedScenarioDescription: { type: String, default: "" },
  normalizedPluginOptions: { type: Array, default: () => [] },
  selectedPluginKeySet: { type: Object, default: () => new Set() },
  selectedModel: { type: String, default: "" },
  memoryModel: { type: String, default: "" },
  modelOptions: { type: Array, default: () => [] },
  pluginModelConfig: { type: Object, default: () => ({}) },
  resolveScenarioLabel: { type: Function, required: true },
});

const emit = defineEmits([
  "update:allowUserInteraction",
  "update:forceTool",
  "update:streamOutput",
  "select-scenario",
  "toggle-programming-scenario",
  "toggle-plugin",
  "update:selectedModel",
  "update:memoryModel",
  "update:pluginModelConfig",
]);

const { translate } = useLocale();

const normalizedModelOptions = computed(() => {
  const optionMap = new Map();
  const addOption = (rawOption) => {
    const value = String(
      typeof rawOption === "string" ? rawOption : rawOption?.value || rawOption?.key || rawOption?.model || "",
    ).trim();
    if (!value || optionMap.has(value)) return;
    const label = String(
      typeof rawOption === "string"
        ? rawOption
        : rawOption?.label || rawOption?.name || rawOption?.alias || rawOption?.model || value,
    ).trim() || value;
    optionMap.set(value, {
      value,
      label,
      alias: String(typeof rawOption === "string" ? value : rawOption?.alias || value).trim() || value,
      key: String(typeof rawOption === "string" ? value : rawOption?.key || rawOption?.alias || value).trim() || value,
      name: String(typeof rawOption === "string" ? label : rawOption?.name || label).trim() || label,
      model: String(typeof rawOption === "string" ? "" : rawOption?.model || "").trim(),
      description: String(typeof rawOption === "string" ? "" : rawOption?.description || "").trim(),
    });
  };
  (Array.isArray(props.modelOptions) ? props.modelOptions : []).forEach(addOption);
  addOption(props.selectedModel);
  collectPluginModelValues(props.pluginModelConfig).forEach(addOption);
  return Array.from(optionMap.values());
});

const hasModelOptions = computed(() => normalizedModelOptions.value.length > 0);

function collectPluginModelValues(pluginModelConfig = {}) {
  const values = [];
  const visit = (node) => {
    if (typeof node === "string" || typeof node === "number") {
      const value = String(node || "").trim();
      if (value) values.push(value);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    Object.values(node).forEach(visit);
  };
  visit(pluginModelConfig && typeof pluginModelConfig === "object" ? pluginModelConfig : {});
  return values;
}

function updatePluginModelConfig(nextConfig = {}) {
  emit("update:pluginModelConfig", nextConfig && typeof nextConfig === "object" ? nextConfig : {});
}

function getModelMetaText(modelItem = {}) {
  return [modelItem.alias && modelItem.alias !== modelItem.label ? modelItem.alias : "", modelItem.model]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" · ");
}

function getSelectedModelLabel() {
  const selectedValue = String(props.selectedModel || "").trim();
  if (!selectedValue) return translate("composer.modelUsingDefault");
  const selectedOption = normalizedModelOptions.value.find((modelItem) => modelItem.value === selectedValue);
  return selectedOption?.label || selectedValue;
}

const composerModelExtensionContext = computed(() => ({
  modelOptions: normalizedModelOptions.value,
  pluginModelConfig: props.pluginModelConfig && typeof props.pluginModelConfig === "object" ? props.pluginModelConfig : {},
  selectedPluginKeySet: props.selectedPluginKeySet,
  updatePluginModelConfig,
  hasModelOptions: hasModelOptions.value,
}));

const composerModelExtensionRenderers = computed(() =>
  resolveComposerModelExtensionRenderers(composerModelExtensionContext.value),
);

function resolveComposerExtensionProps(renderer = {}) {
  return {
    modelOptions: normalizedModelOptions.value,
    pluginModelConfig: props.pluginModelConfig && typeof props.pluginModelConfig === "object" ? props.pluginModelConfig : {},
    selectedPluginKeySet: props.selectedPluginKeySet,
    hasModelOptions: hasModelOptions.value,
    updatePluginModelConfig,
    ...resolveComposerModelExtensionProps(renderer, composerModelExtensionContext.value),
  };
}
</script>

<template>
  <div class="composer-options">
    <div class="composer-toggle-panel noobot-soft-card">
      <el-switch
        :model-value="allowUserInteraction"
        inline-prompt
        :active-text="translate('composer.allowInteraction')"
        :inactive-text="translate('composer.disallowInteraction')"
        class="interaction-switch"
        @update:model-value="emit('update:allowUserInteraction', $event)"
      />
      <el-switch
        :model-value="forceTool"
        inline-prompt
        :active-text="translate('composer.forceTool')"
        :inactive-text="translate('composer.notForceTool')"
        class="interaction-switch"
        @update:model-value="emit('update:forceTool', $event)"
      />
      <el-switch
        :model-value="streamOutput"
        inline-prompt
        :active-text="translate('composer.streaming')"
        :inactive-text="translate('composer.nonStreaming')"
        class="interaction-switch"
        @update:model-value="emit('update:streamOutput', $event)"
      />
    </div>

    <div class="option-selector scenario-selector noobot-soft-card">
      <span class="scenario-selector-label">{{ translate("composer.botScenario") }}</span>
      <div v-if="normalizedScenarioOptions.length" class="option-button-group scenario-button-group">
        <el-button
          v-for="scenarioItem in normalizedScenarioOptions"
          :key="scenarioItem.key"
          size="small"
          class="composer-option-button scenario-option-button noobot-pill-option"
          :type="String(botScenario || '').trim() === scenarioItem.key ? 'primary' : 'default'"
          :title="scenarioItem.description || resolveScenarioLabel(scenarioItem)"
          @click="emit('select-scenario', scenarioItem.key)"
        >
          {{ resolveScenarioLabel(scenarioItem) }}
        </el-button>
      </div>
      <el-button
        v-else
        size="small"
        class="composer-option-button scenario-option-button noobot-pill-option"
        :type="String(botScenario || '').trim().toLowerCase() === 'programming' ? 'primary' : 'default'"
        @click="emit('toggle-programming-scenario')"
      >
        {{ translate("composer.scenarioProgramming") }}
      </el-button>
    </div>

    <div class="option-selector plugin-selector noobot-soft-card">
      <span class="scenario-selector-label">{{ translate("composer.availablePlugins") }}</span>
      <div v-if="normalizedPluginOptions.length" class="option-button-group plugin-button-group">
        <el-button
          v-for="pluginItem in normalizedPluginOptions"
          :key="pluginItem.key"
          size="small"
          class="composer-option-button plugin-option-button noobot-pill-option"
          :type="selectedPluginKeySet.has(pluginItem.key) ? 'primary' : 'default'"
          :disabled="pluginItem.enabled === false"
          :title="pluginItem.description || pluginItem.label"
          @click="emit('toggle-plugin', pluginItem.key)"
        >
          {{ pluginItem.label || pluginItem.key }}
        </el-button>
      </div>
      <span v-else class="plugin-empty-text">{{ translate("composer.noAvailablePlugins") }}</span>
    </div>

    <section class="model-config-panel noobot-panel-card">
      <div class="model-config-heading">
        <div>
          <div class="model-config-header">{{ translate("composer.modelSelection") }}</div>
          <p class="model-config-description">{{ translate("composer.modelSelectionDescription") }}</p>
        </div>
        <el-tag size="small" effect="plain" class="model-status-tag">
          {{ getSelectedModelLabel() }}
        </el-tag>
      </div>
      <div class="model-select-card noobot-soft-card">
        <div class="model-field-copy">
          <span class="model-field-label">{{ translate("composer.mainFlowModel") }}</span>
          <span class="model-field-hint">{{ translate("composer.mainFlowModelHint") }}</span>
        </div>
        <el-select
          :model-value="selectedModel"
          size="small"
          clearable
          :filterable="false"
          popper-class="noobot-composer-select-popper noobot-model-select-popper"
          :disabled="!hasModelOptions"
          :placeholder="translate('composer.useDefaultModel')"
          class="composer-select model-select noobot-model-select-control"
          @update:model-value="emit('update:selectedModel', String($event || '').trim())"
        >
          <el-option
            v-for="modelItem in normalizedModelOptions"
            :key="modelItem.value"
            :label="modelItem.label"
            :value="modelItem.value"
            class="model-select-option"
          >
            <div class="model-option-content">
              <span class="model-option-label">{{ modelItem.label }}</span>
              <span v-if="getModelMetaText(modelItem)" class="model-option-meta">{{ getModelMetaText(modelItem) }}</span>
              <span v-if="modelItem.description" class="model-option-description">{{ modelItem.description }}</span>
            </div>
          </el-option>
        </el-select>
        <span v-if="!hasModelOptions" class="plugin-empty-text">{{ translate("composer.noAvailableModels") }}</span>
      </div>

      <div class="model-select-card noobot-soft-card">
        <div class="model-field-copy">
          <span class="model-field-label">{{ translate("composer.memoryExperienceModel") }}</span>
          <span class="model-field-hint">{{ translate("composer.memoryExperienceModelHint") }}</span>
        </div>
        <el-select
          :model-value="memoryModel"
          size="small"
          clearable
          :filterable="false"
          popper-class="noobot-composer-select-popper noobot-model-select-popper"
          :disabled="!hasModelOptions"
          :placeholder="translate('composer.useDefaultModel')"
          class="composer-select model-select noobot-model-select-control"
          @update:model-value="emit('update:memoryModel', String($event || '').trim())"
        >
          <el-option
            v-for="modelItem in normalizedModelOptions"
            :key="`memory-${modelItem.value}`"
            :label="modelItem.label"
            :value="modelItem.value"
            class="model-select-option"
          >
            <div class="model-option-content">
              <span class="model-option-label">{{ modelItem.label }}</span>
              <span v-if="getModelMetaText(modelItem)" class="model-option-meta">{{ getModelMetaText(modelItem) }}</span>
              <span v-if="modelItem.description" class="model-option-description">{{ modelItem.description }}</span>
            </div>
          </el-option>
        </el-select>
      </div>

      <div class="plugin-model-extension">
        <div class="plugin-extension-heading">
          <div class="model-config-subtitle">{{ translate("composer.pluginModelExtensions") }}</div>
          <p class="model-config-description">{{ translate("composer.pluginModelExtensionsDescription") }}</p>
        </div>
        <component
          :is="extensionRenderer.component"
          v-for="extensionRenderer in composerModelExtensionRenderers"
          :key="extensionRenderer.id"
          v-bind="resolveComposerExtensionProps(extensionRenderer)"
        />
        <span v-if="!composerModelExtensionRenderers.length" class="plugin-empty-text">
          {{ translate("composer.noPluginModelExtensions") }}
        </span>
      </div>
    </section>

    <p v-if="selectedScenarioDescription" class="scenario-description">
      {{ selectedScenarioDescription }}
    </p>
  </div>
</template>

<style scoped>
.composer-options {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.interaction-switch {
  --el-switch-on-color: var(--noobot-cyber-cyan, var(--noobot-base-blue-500));
  --el-switch-off-color: var(--noobot-status-idle, var(--noobot-status-idle));
}

.composer-toggle-panel {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
}

.option-selector {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  min-width: 0;
  padding: 10px 12px;
}

.scenario-selector-label {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 18px;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  font-weight: 650;
}

.option-button-group {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.composer-option-button {
  /* keep component hook; visual style comes from .noobot-pill-option */
}

.composer-select {
  width: 100%;
  min-width: 0;
}

.composer-select :deep(.el-select__wrapper) {
  min-height: 38px;
  height: 38px;
  box-sizing: border-box;
  border-radius: var(--noobot-radius-md);
  background: color-mix(in srgb, var(--noobot-control-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay))) 94%, var(--el-color-primary));
  border-color: color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 78%, transparent);
  box-shadow: var(--noobot-control-shadow);
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.composer-select :deep(.el-select__wrapper.is-focused),
.composer-select :deep(.el-select__wrapper:hover) {
  border-color: color-mix(in srgb, var(--el-color-primary) 50%, var(--noobot-panel-border, var(--el-border-color)));
  box-shadow: var(--noobot-control-shadow-focus);
}

.composer-select :deep(.el-select__selected-item),
.composer-select :deep(.el-select__placeholder) {
  min-width: 0;
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.composer-select :deep(.el-select__placeholder.is-transparent) {
  color: var(--noobot-text-muted, var(--el-text-color-placeholder));
}

.plugin-empty-text {
  font-size: 12px;
  color: var(--noobot-text-muted, var(--el-text-color-secondary));
}

.model-config-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 14px;
}

.model-config-heading,
.plugin-extension-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.model-config-header,
.model-config-subtitle {
  font-size: 13px;
  font-weight: 700;
  color: var(--noobot-text-strong, var(--el-text-color-primary));
}

.model-config-description,
.model-field-hint {
  margin: 3px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
}

.model-status-tag {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-color-primary);
  border-color: color-mix(in srgb, var(--el-color-primary) 42%, var(--noobot-panel-border, var(--el-border-color)));
  background: color-mix(in srgb, var(--el-color-primary) 9%, var(--noobot-panel-bg, var(--el-bg-color-overlay)));
}

.model-select-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 360px);
  align-items: center;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
}

.model-field-copy {
  display: flex;
  flex-direction: column;
  min-width: 150px;
  flex: 1 1 180px;
  overflow-wrap: anywhere;
}

.model-field-label {
  font-size: 13px;
  font-weight: 650;
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.model-select {
  width: 100%;
  min-width: 0;
}

.model-option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.model-option-label {
  font-weight: 650;
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.model-option-meta,
.model-option-description {
  font-size: 12px;
  line-height: 1.35;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
}

.model-option-description {
  color: var(--noobot-text-muted, var(--el-text-color-secondary));
}

.plugin-model-extension {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding-top: 2px;
}

.scenario-description {
  margin: 0;
  width: 100%;
  font-size: 12px;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
}

@media (max-width: 768px) {
  .composer-options,
  .composer-toggle-panel,
  .scenario-selector,
  .plugin-selector,
  .model-select-card,
  .model-config-heading,
  .plugin-extension-heading {
    width: 100%;
    align-items: flex-start;
  }

  .composer-options {
    gap: 10px;
  }

  .model-config-panel {
    padding: 12px;
    border-radius: var(--noobot-radius-lg);
  }

  .model-select-card,
  .model-config-heading,
  .plugin-extension-heading {
    display: flex;
    flex-direction: column;
  }

  .model-status-tag {
    max-width: 100%;
    min-height: 24px;
  }

  .model-field-copy {
    width: 100%;
    min-width: 0;
    flex-basis: auto;
  }

  .model-select {
    width: 100%;
    flex-basis: auto;
  }

  .model-select :deep(.el-select__wrapper) {
    min-height: 38px;
    height: 38px;
  }

  .option-selector {
    gap: 6px;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .composer-toggle-panel {
    padding: 10px;
    gap: 8px;
  }

  .option-button-group {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
    width: 100%;
    gap: 6px;
  }

  .composer-option-button {
    width: 100%;
    min-height: 32px;
    padding: 5px 8px;
    justify-content: center;
  }

  .composer-select {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .model-config-panel {
    padding: 10px;
    gap: 10px;
  }

  .model-select-card {
    display: flex;
    padding: 10px;
  }

  .model-config-description,
  .model-field-hint,
  .scenario-description {
    font-size: 12px;
    line-height: 1.5;
  }
}

:global(.noobot-composer-select-popper) {
  width: auto !important;
  max-width: calc(100vw - 32px);
  border-color: color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 82%, transparent);
  background: var(--noobot-control-menu-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay))) !important;
  overflow: hidden !important;
  border-radius: var(--noobot-radius-md);
  box-shadow: var(--noobot-shadow-overlay);
}

:global(.noobot-composer-select-popper .el-select-dropdown),
:global(.noobot-composer-select-popper .el-popper__content),
:global(.noobot-composer-select-popper .el-scrollbar),
:global(.noobot-composer-select-popper .el-scrollbar__view),
:global(.noobot-composer-select-popper .el-select-dropdown__list) {
  background: var(--noobot-control-menu-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay))) !important;
}

:global(.noobot-composer-select-popper .el-select-dropdown__wrap) {
  max-height: min(40vh, 300px);
  background: var(--noobot-control-menu-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay))) !important;
}

:global(.noobot-composer-select-popper .el-select-dropdown__list) {
  box-sizing: border-box;
  padding: 4px;
}

:global(.noobot-composer-select-popper .el-select-dropdown__item) {
  height: auto;
  min-height: 44px;
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--noobot-radius-xs);
  line-height: 1.35;
  color: var(--noobot-text-main, var(--el-text-color-primary));
  background: transparent !important;
  white-space: normal;
}

:global(.noobot-composer-select-popper .el-select-dropdown__item.hover),
:global(.noobot-composer-select-popper .el-select-dropdown__item:hover) {
  color: var(--noobot-text-strong, var(--el-text-color-primary)) !important;
  background: color-mix(in srgb, var(--el-color-primary) 10%, var(--noobot-control-menu-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay)))) !important;
}

:global(.noobot-composer-select-popper .el-select-dropdown__item.is-selected) {
  color: var(--el-color-primary) !important;
  background: color-mix(in srgb, var(--el-color-primary) 14%, var(--noobot-control-menu-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay)))) !important;
}

:global(.noobot-composer-select-popper .el-select-dropdown__item.is-selected.hover),
:global(.noobot-composer-select-popper .el-select-dropdown__item.is-selected:hover) {
  background: color-mix(in srgb, var(--el-color-primary) 18%, var(--noobot-control-menu-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay)))) !important;
}

:global(.noobot-composer-select-popper .el-select-dropdown__empty) {
  color: var(--noobot-text-muted, var(--el-text-color-secondary));
  background: var(--noobot-control-menu-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay))) !important;
}

:global(.noobot-composer-select-popper .el-popper__arrow::before) {
  background: var(--noobot-control-menu-bg, var(--noobot-panel-bg, var(--el-bg-color-overlay))) !important;
  border-color: color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 82%, transparent) !important;
}

@media (max-width: 768px) {
  :global(.noobot-composer-select-popper) {
    min-width: 0 !important;
    max-width: calc(100vw - 32px) !important;
    max-height: min(44vh, 320px) !important;
    border-radius: var(--noobot-radius-md) !important;
    overflow: hidden auto !important;
    overscroll-behavior: contain;
    box-shadow: var(--noobot-shadow-overlay) !important;
  }

  :global(.noobot-composer-select-popper[data-popper-placement^="bottom"]) {
    margin-top: 6px !important;
  }

  :global(.noobot-composer-select-popper[data-popper-placement^="top"]) {
    margin-bottom: 6px !important;
  }

  :global(.noobot-composer-select-popper .el-select-dropdown__wrap) {
    max-height: min(36vh, 280px);
    overscroll-behavior: contain;
  }

  :global(.noobot-composer-select-popper .el-select-dropdown__item) {
    min-height: 42px;
    padding: 8px 10px;
  }

  :global(.noobot-composer-select-popper .el-popper__arrow) {
    display: none;
  }
}
</style>
