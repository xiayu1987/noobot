<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { Connection } from "@element-plus/icons-vue";
import { useLocale } from "../../../shared/i18n/useLocale.js";

const props = defineProps({
  connectorPanelState: { type: Object, default: () => ({}) },
  embedded: { type: Boolean, default: false },
});
const emit = defineEmits(["selection-change"]);
const { translate } = useLocale();

const connectedConnectors = computed(() =>
  (Array.isArray(props.connectorPanelState?.connectors)
    ? props.connectorPanelState.connectors
    : []
  ).filter((item) => item?.status === "connected"),
);
const selectedConnectorIds = computed(() =>
  Array.isArray(props.connectorPanelState?.selectedConnectorIds)
    ? props.connectorPanelState.selectedConnectorIds
    : [],
);
</script>

<template>
  <section class="connector-selector noobot-flat-card">
    <header class="connector-selector-header">
      <el-icon><Connection /></el-icon>
      <span>{{ translate("composer.connectors") }}</span>
    </header>
    <el-checkbox-group
      class="connector-options"
      :model-value="selectedConnectorIds"
      @update:model-value="emit('selection-change', $event)"
    >
      <el-checkbox
        v-for="connector in connectedConnectors"
        :key="connector.connectorId"
        :value="connector.connectorId"
        class="connector-option noobot-selectable-row"
      >
        <span class="connector-name">{{ connector.name }}</span>
        <span class="connector-kind">{{ connector.type }} / {{ connector.subType }}</span>
      </el-checkbox>
    </el-checkbox-group>
    <div v-if="!connectedConnectors.length" class="connector-empty">
      {{ translate("composer.noAvailableConnections") }}
    </div>
  </section>
</template>

<style scoped>
.connector-selector {
  padding: var(--noobot-space-md);
}
.connector-selector-header {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  font-weight: 650;
}
.connector-options {
  display: grid;
  gap: var(--noobot-space-xs);
  margin-top: var(--noobot-space-sm);
}
.connector-option {
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: var(--noobot-space-xs);
}
.connector-name {
  font-weight: 600;
}
.connector-kind {
  margin-left: var(--noobot-space-xs);
  color: var(--noobot-text-secondary);
  font-size: 12px;
}
.connector-empty {
  padding: var(--noobot-space-lg) var(--noobot-space-2xs) var(--noobot-space-2xs);
  color: var(--noobot-text-secondary);
  font-size: 13px;
}
</style>
