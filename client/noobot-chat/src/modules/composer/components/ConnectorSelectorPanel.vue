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
  padding: 12px;
}
.connector-selector-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
}
.connector-options {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}
.connector-option {
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 8px;
}
.connector-name {
  font-weight: 600;
}
.connector-kind {
  margin-left: 8px;
  color: var(--noobot-text-secondary);
  font-size: 12px;
}
.connector-empty {
  padding: 14px 4px 4px;
  color: var(--noobot-text-secondary);
  font-size: 13px;
}
</style>
