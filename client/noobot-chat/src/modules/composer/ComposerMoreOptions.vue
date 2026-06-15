<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  allowUserInteraction: { type: Boolean, default: true },
  forceTool: { type: Boolean, default: false },
  streamOutput: { type: Boolean, default: true },
  botScenario: { type: String, default: "" },
  normalizedScenarioOptions: { type: Array, default: () => [] },
  selectedScenarioDescription: { type: String, default: "" },
  normalizedPluginOptions: { type: Array, default: () => [] },
  selectedPluginKeySet: { type: Object, default: () => new Set() },
  resolveScenarioLabel: { type: Function, required: true },
});

const emit = defineEmits([
  "update:allowUserInteraction",
  "update:forceTool",
  "update:streamOutput",
  "select-scenario",
  "toggle-programming-scenario",
  "toggle-plugin",
]);

const { translate } = useLocale();
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
  color: var(--noobot-text-secondary, #52525b);
}

.plugin-button-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

.plugin-empty-text {
  font-size: 12px;
  color: var(--noobot-text-muted, #71717a);
}

.scenario-description {
  margin: 0;
  width: 100%;
  font-size: 12px;
  color: var(--noobot-text-secondary, #52525b);
}

@media (max-width: 768px) {
  .composer-options,
  .scenario-selector,
  .plugin-selector {
    width: 100%;
    align-items: flex-start;
  }

  .plugin-button-group {
    max-width: 100%;
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 2px;
  }
}
</style>
