<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref } from "vue";
import {
  ArrowDown,
  CircleCheckFilled,
  WarningFilled,
  CircleCloseFilled,
  Connection,
} from "@element-plus/icons-vue";

const CONNECTOR_GROUP_DEFINITIONS = [
  { key: "database", label: "数据库" },
  { key: "terminal", label: "终端" },
  { key: "email", label: "邮件" },
];
const CONNECTOR_GROUP_KEYS = new Set(
  CONNECTOR_GROUP_DEFINITIONS.map((groupDefinition) => groupDefinition.key),
);

const props = defineProps({
  connectorPanelState: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["connector-selected"]);

const connectorPanelExpanded = ref(false);

const connectorGroups = computed(() => {
  const sourceGroups =
    props?.connectorPanelState?.groups &&
    typeof props.connectorPanelState.groups === "object"
      ? props.connectorPanelState.groups
      : {};
  return {
    database: Array.isArray(sourceGroups.database) ? sourceGroups.database : [],
    terminal: Array.isArray(sourceGroups.terminal) ? sourceGroups.terminal : [],
    email: Array.isArray(sourceGroups.email) ? sourceGroups.email : [],
  };
});

const selectedConnectors = computed(() => {
  const selectedSource =
    props?.connectorPanelState?.selectedConnectors &&
    typeof props.connectorPanelState.selectedConnectors === "object"
      ? props.connectorPanelState.selectedConnectors
      : {};
  return {
    database: String(selectedSource?.database || "").trim(),
    terminal: String(selectedSource?.terminal || "").trim(),
    email: String(selectedSource?.email || "").trim(),
  };
});

const collapsedConnectorSummaryItems = computed(() =>
  CONNECTOR_GROUP_DEFINITIONS.map((groupDefinition) => {
    const selectedConnectorName = String(
      selectedConnectors.value?.[groupDefinition.key] || "",
    ).trim();
    if (!selectedConnectorName) return null;
    return `${groupDefinition.label}: ${selectedConnectorName}`;
  }).filter(Boolean),
);

function connectorStatusIcon(status = "") {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus === "connected") return CircleCheckFilled;
  if (normalizedStatus === "error") return CircleCloseFilled;
  return WarningFilled;
}

function connectorStatusClass(status = "") {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus === "connected") return "status-connected";
  if (normalizedStatus === "error") return "status-error";
  return "status-unknown";
}

function onConnectorSelected(connectorType = "", connectorName = "") {
  const normalizedType = String(connectorType || "").trim();
  if (!CONNECTOR_GROUP_KEYS.has(normalizedType)) return;
  const normalizedName = String(connectorName || "").trim();
  emit("connector-selected", {
    connectorType: normalizedType,
    connectorName: normalizedName,
  });
}

function toggleConnectorPanelExpanded() {
  connectorPanelExpanded.value = !connectorPanelExpanded.value;
}
</script>

<template>
  <div
    class="connector-panel-shell noobot-flat-card"
    :class="{ 'is-expanded': connectorPanelExpanded }"
  >
    <div class="connector-panel-header" @click="toggleConnectorPanelExpanded">
      <div class="connector-panel-title">
        <el-icon class="title-icon"><Connection /></el-icon>
        <span>连接器</span>
      </div>

      <div class="connector-collapsed-summary" v-show="!connectorPanelExpanded">
        <span
          v-for="summaryItem in collapsedConnectorSummaryItems"
          :key="summaryItem"
          class="connector-summary-pill noobot-flat-chip"
        >
          {{ summaryItem }}
        </span>
        <span
          v-if="!collapsedConnectorSummaryItems.length"
          class="connector-summary-empty"
        >
          未选择连接器
        </span>
      </div>

      <div class="connector-toggle-btn noobot-flat-soft-btn">
        <span class="toggle-text">{{ connectorPanelExpanded ? "收起" : "展开" }}</span>
        <el-icon class="connector-toggle-icon" :class="{ 'is-rotated': connectorPanelExpanded }">
          <ArrowDown />
        </el-icon>
      </div>
    </div>

    <el-collapse-transition>
      <div v-show="connectorPanelExpanded" class="connector-panel">
        <div class="connector-categories-grid">
          <div
            v-for="groupDefinition in CONNECTOR_GROUP_DEFINITIONS"
            :key="groupDefinition.key"
            class="connector-group noobot-flat-card"
          >
            <div class="connector-group-title">{{ groupDefinition.label }}</div>
            <el-radio-group
              class="vertical-radio-group"
              :model-value="selectedConnectors[groupDefinition.key]"
              @update:model-value="onConnectorSelected(groupDefinition.key, $event)"
            >
              <el-radio
                v-for="connectorItem in connectorGroups[groupDefinition.key]"
                :key="`${groupDefinition.key}-${connectorItem.connectorName}`"
                :value="connectorItem.connectorName"
                class="custom-radio"
              >
                <span class="connector-option">
                  <el-icon
                    class="connector-status-icon"
                    :class="connectorStatusClass(connectorItem.status)"
                  >
                    <component :is="connectorStatusIcon(connectorItem.status)" />
                  </el-icon>
                  <span class="connector-name" :title="connectorItem.connectorName">
                    {{ connectorItem.connectorName }}
                  </span>
                </span>
              </el-radio>

              <div v-if="!connectorGroups[groupDefinition.key]?.length" class="empty-group-tip">
                暂无可用连接
              </div>
            </el-radio-group>
          </div>
        </div>
      </div>
    </el-collapse-transition>
  </div>
</template>

<style scoped>
.connector-panel-shell {
  background: var(--noobot-panel-bg);
  overflow: hidden;
  transition: all 0.3s ease;
}

.connector-panel-shell.is-expanded {
  background: var(--noobot-panel-bg);
  box-shadow: none;
}

.connector-panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
}

.connector-panel-header:hover {
  background: var(--noobot-panel-muted);
}

.connector-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--noobot-text-secondary);
  flex-shrink: 0;
}

.title-icon {
  font-size: 14px;
  color: var(--noobot-text-accent);
}

.connector-collapsed-summary {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}

.connector-collapsed-summary::-webkit-scrollbar {
  display: none;
}

.connector-summary-pill {
  padding: 2px 8px;
  color: var(--noobot-text-main);
  flex-shrink: 0;
}

.connector-summary-empty {
  font-size: 12px;
  color: var(--noobot-text-muted);
}

.connector-toggle-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--noobot-text-muted);
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 999px;
  transition: all 0.2s;
  margin-left: auto;
}

.connector-panel-header:hover .connector-toggle-btn {
  color: var(--noobot-text-main);
}

.connector-toggle-icon {
  transition: transform 0.3s ease;
}

.connector-toggle-icon.is-rotated {
  transform: rotate(180deg);
}

.connector-panel {
  padding: 0 12px 12px 12px;
  border-top: 1px solid var(--noobot-divider);
}

.connector-categories-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
  margin-top: 12px;
}

.connector-group {
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: var(--noobot-space-sm);
}

.connector-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--noobot-text-secondary);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--noobot-divider);
}

.vertical-radio-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.custom-radio {
  display: flex;
  align-items: center;
  margin-right: 0;
  height: 30px;
  padding: 4px 0;
}

.custom-radio :deep(.el-radio__input) {
  display: inline-flex;
}

.custom-radio :deep(.el-radio__label) {
  display: flex;
  padding-left: 6px;
  height: 100%;
}

.custom-radio :deep(.el-radio__inner) {
  background-color: color-mix(in srgb, var(--noobot-panel-bg) 88%, var(--noobot-surface-sidebar));
  border-color: var(--noobot-panel-border);
}

.connector-option {
  display: flex;
  gap: 6px;
  height: 100%;
  align-items: center;
}

.connector-status-icon {
  font-size: 13px;
  display: inline-flex;
  align-items: center;
}

.connector-status-icon.status-connected {
  color: var(--noobot-status-success);
}
.connector-status-icon.status-error {
  color: var(--noobot-status-error);
}
.connector-status-icon.status-unknown {
  color: var(--noobot-text-accent);
}

.connector-name {
  font-size: 13px;
  color: var(--noobot-text-main);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  height: 100%;
}

.empty-group-tip {
  font-size: 12px;
  color: var(--noobot-text-muted);
  padding: 4px 0;
}

@media (max-width: 768px) {
  .connector-categories-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
</style>
