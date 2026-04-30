<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../shared/i18n/useLocale";

defineProps({
  connectorSummaryGroups: { type: Array, default: () => [] },
  connectorStatusClass: { type: Function, required: true },
  connectorStatusIcon: { type: Function, required: true },
});
const { t } = useLocale();
</script>

<template>
  <div class="connector-summary noobot-flat-card">
    <div class="connector-summary-title">{{ t("common.selectedConnectors") }}</div>
    <div class="connector-summary-list">
      <div
        v-for="connectorGroup in connectorSummaryGroups"
        :key="connectorGroup.key"
        class="connector-summary-item noobot-flat-chip"
      >
        <span class="connector-summary-label">{{ connectorGroup.label }}</span>
        <span
          v-if="connectorGroup.selectedName"
          class="connector-summary-value"
        >
          <el-icon
            class="connector-summary-status"
            :class="connectorStatusClass(connectorGroup.status)"
          >
            <component :is="connectorStatusIcon(connectorGroup.status)" />
          </el-icon>
          <span class="connector-summary-name">{{ connectorGroup.selectedName }}</span>
        </span>
        <span v-else class="connector-summary-empty">{{ t("common.unselected") }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.connector-summary {
  margin: 16px;
  padding: 14px;
  background: var(--noobot-panel-muted);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.connector-summary-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--noobot-text-secondary);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.connector-summary-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.connector-summary-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
  padding: 4px 8px;
}

.connector-summary-label {
  color: var(--noobot-text-secondary);
  flex-shrink: 0;
}

.connector-summary-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.connector-summary-status {
  font-size: 12px;
}

.connector-summary-status.status-connected {
  color: var(--noobot-status-success);
}
.connector-summary-status.status-error {
  color: var(--noobot-status-error);
}
.connector-summary-status.status-unknown {
  color: var(--noobot-text-accent);
}

.connector-summary-name {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--noobot-text-strong);
  font-weight: 500;
}

.connector-summary-empty {
  color: var(--noobot-text-muted);
  font-style: italic;
}
</style>
