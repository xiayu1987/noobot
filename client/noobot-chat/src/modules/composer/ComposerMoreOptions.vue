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

    <div class="scenario-selector">
      <span class="scenario-selector-label">{{ translate("composer.botScenario") }}</span>
      <template v-if="normalizedScenarioOptions.length">
        <el-button
          v-for="scenarioItem in normalizedScenarioOptions"
          :key="scenarioItem.key"
          size="small"
          :type="String(botScenario || '').trim() === scenarioItem.key ? 'primary' : 'default'"
          :title="scenarioItem.description || resolveScenarioLabel(scenarioItem)"
          @click="emit('select-scenario', scenarioItem.key)"
        >
          {{ resolveScenarioLabel(scenarioItem) }}
        </el-button>
      </template>
      <el-button
        v-else
        size="small"
        :type="String(botScenario || '').trim().toLowerCase() === 'programming' ? 'primary' : 'default'"
        @click="emit('toggle-programming-scenario')"
      >
        {{ translate("composer.scenarioProgramming") }}
      </el-button>
    </div>

    <div class="plugin-selector">
      <span class="scenario-selector-label">{{ translate("composer.availablePlugins") }}</span>
      <div v-if="normalizedPluginOptions.length" class="plugin-button-group">
        <el-button
          v-for="pluginItem in normalizedPluginOptions"
          :key="pluginItem.key"
          size="small"
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

    <section class="model-config-panel">
      <div class="model-config-heading">
        <div>
          <div class="model-config-header">{{ translate("composer.modelSelection") }}</div>
          <p class="model-config-description">{{ translate("composer.modelSelectionDescription") }}</p>
        </div>
        <el-tag size="small" effect="plain" class="model-status-tag">
          {{ getSelectedModelLabel() }}
        </el-tag>
      </div>
      <div class="model-select-card">
        <div class="model-field-copy">
          <span class="model-field-label">{{ translate("composer.mainFlowModel") }}</span>
          <span class="model-field-hint">{{ translate("composer.mainFlowModelHint") }}</span>
        </div>
        <el-select
          :model-value="selectedModel"
          size="small"
          clearable
          filterable
          :disabled="!hasModelOptions"
          :placeholder="translate('composer.useDefaultModel')"
          class="model-select"
          @update:model-value="emit('update:selectedModel', String($event || '').trim())"
        >
          <el-option
            v-for="modelItem in normalizedModelOptions"
            :key="modelItem.value"
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
        <span v-if="!hasModelOptions" class="plugin-empty-text">{{ translate("composer.noAvailableModels") }}</span>
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
  gap: 12px;
  flex-wrap: wrap;
}

.interaction-switch {
  --el-switch-on-color: var(--noobot-cyber-cyan, #0ea5e9);
  --el-switch-off-color: var(--noobot-status-idle, #d4d4d8);
}

.scenario-selector,
.plugin-selector {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.scenario-selector-label {
  font-size: 13px;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
}

.plugin-button-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

.plugin-empty-text {
  font-size: 12px;
  color: var(--noobot-text-muted, var(--el-text-color-secondary));
}

.model-config-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 78%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--noobot-panel-bg, var(--el-bg-color-overlay)) 94%, var(--noobot-surface-sidebar, var(--el-fill-color-light)));
  box-shadow: 0 10px 28px color-mix(in srgb, var(--el-color-primary) 8%, transparent);
}

.model-config-heading,
.plugin-extension-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
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
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 70%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--noobot-surface-sidebar, var(--el-bg-color)) 88%, var(--el-fill-color-light));
}

.model-field-copy {
  display: flex;
  flex-direction: column;
  min-width: 150px;
}

.model-field-label {
  font-size: 13px;
  font-weight: 650;
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.model-select {
  width: min(360px, 100%);
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
}

.scenario-description {
  margin: 0;
  width: 100%;
  font-size: 12px;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
}

@media (max-width: 768px) {
  .composer-options,
  .scenario-selector,
  .plugin-selector,
  .model-select-card,
  .model-config-heading,
  .plugin-extension-heading {
    width: 100%;
    align-items: flex-start;
  }

  .model-select-card,
  .model-config-heading,
  .plugin-extension-heading {
    flex-direction: column;
  }

  .model-select {
    width: 100%;
  }

  .plugin-button-group {
    max-width: 100%;
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 2px;
  }
}
</style>
