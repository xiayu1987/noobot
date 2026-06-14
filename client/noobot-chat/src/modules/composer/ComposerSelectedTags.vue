<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  selectedConnectorNames: { type: Array, default: () => [] },
  selectedScenarioLabel: { type: String, default: "" },
  selectedPluginLabels: { type: Array, default: () => [] },
});

const { translate } = useLocale();
</script>

<template>
  <div
    v-if="selectedConnectorNames.length || selectedScenarioLabel || selectedPluginLabels.length"
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

@media (max-width: 768px) {
  .selected-connectors-row {
    margin-bottom: 8px;
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: none;
  }
}
</style>
