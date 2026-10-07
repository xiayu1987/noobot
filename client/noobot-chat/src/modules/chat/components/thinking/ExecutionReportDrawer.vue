<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, ref, watch } from "vue";
import {
  BaseEmptyHint,
  BaseSectionHeader,
  useMobileViewport,
} from "../../../../shared/public-api/ui.js";
import { executionReportService } from "../../../../infrastructure/api/thinking/executionReportService.js";
import { getMessageDialogProcessId, getMessageSessionId } from "../../model/messageIdentity.js";
import { buildExecutionReportView } from "../../model/executionReportModel.js";

const props = defineProps({
  visible: Boolean,
  messageItem: { type: Object, required: true },
  userId: { type: String, default: "" },
  translate: { type: Function, required: true },
  fetchExecutionReport: { type: Function, default: null },
});
const emit = defineEmits(["update:visible"]);

const loading = ref(false);
const errorText = ref("");
const report = ref(null);
const { drawerSize } = useMobileViewport();
const view = computed(() => buildExecutionReportView(report.value, props.translate));
const metaSections = computed(() =>
  [
    { key: "model", title: "message.executionReportModelSection", rows: view.value?.model },
    { key: "phases", title: "message.executionReportPhaseSection", rows: view.value?.phases },
  ].filter((section) => section.rows?.length),
);

function barStyle(ratio) {
  return { width: `${Math.round(ratio * 100)}%` };
}

async function loadReport() {
  loading.value = true;
  errorText.value = "";
  report.value = null;
  try {
    const request = {
      userId: props.userId,
      sessionId: getMessageSessionId(props.messageItem),
      dialogProcessId: getMessageDialogProcessId(props.messageItem),
    };
    report.value =
      (typeof props.fetchExecutionReport === "function"
        ? await props.fetchExecutionReport(request)
        : await executionReportService.getReport(request)) || null;
  } catch (error) {
    errorText.value = String(error?.message || error);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) void loadReport();
  },
  { immediate: true },
);
</script>

<template>
  <el-drawer
    :model-value="visible"
    :title="translate('message.executionReport')"
    direction="rtl"
    :size="drawerSize"
    append-to-body
    class="execution-report-drawer workspace-drawer noobot-side-drawer"
    @update:model-value="emit('update:visible', $event)"
  >
    <BaseEmptyHint v-if="loading" :text="translate('message.executionReportLoading')" />
    <BaseEmptyHint v-else-if="errorText" :text="errorText" />
    <BaseEmptyHint v-else-if="!view" :text="translate('message.executionReportEmpty')" />
    <div v-else class="execution-report-body" data-testid="execution-report-body">
      <section class="execution-report-section" data-testid="execution-report-overview">
        <div class="execution-report-overview-head">
          <BaseSectionHeader :title="translate('message.executionReportOverview')" />
          <span class="execution-report-status noobot-flat-chip" :data-tone="view.status.tone">
            <span class="execution-report-dot"></span>{{ view.status.text }}
          </span>
        </div>
        <div class="execution-report-cards">
          <div
            v-for="item in view.cards"
            :key="item.key"
            class="execution-report-card"
            :data-tone="item.tone || undefined"
          >
            <span class="execution-report-card-value">{{ item.value }}</span>
            <span class="execution-report-card-label">{{ item.label }}</span>
          </div>
        </div>
      </section>

      <section v-if="view.error" class="execution-report-section">
        <BaseSectionHeader :title="translate('message.executionReportError')" />
        <p class="execution-report-error">{{ view.error }}</p>
      </section>

      <div v-if="metaSections.length" class="execution-report-grid">
        <section
          v-for="section in metaSections"
          :key="section.key"
          class="execution-report-section execution-report-panel"
          :data-testid="`execution-report-${section.key}`"
        >
          <BaseSectionHeader :title="translate(section.title)" />
          <dl class="execution-report-meta">
            <template v-for="item in section.rows" :key="item.label">
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </template>
          </dl>
        </section>
      </div>

      <section v-if="view.risks.length" class="execution-report-section">
        <BaseSectionHeader :title="translate('message.executionReportRiskSection')" />
        <div class="execution-report-chips" data-testid="execution-report-risks">
          <span
            v-for="risk in view.risks"
            :key="risk.level"
            class="execution-report-chip noobot-flat-chip"
            :data-risk="risk.level"
            :data-tone="risk.tone"
            >{{ risk.level }} × {{ risk.count }}</span
          >
        </div>
      </section>

      <section v-if="view.tools.length" class="execution-report-section">
        <BaseSectionHeader :title="translate('message.executionReportToolSection')" />
        <div class="execution-report-table-wrap execution-report-panel">
          <table class="execution-report-table" data-testid="execution-report-tools">
            <thead>
              <tr>
                <th scope="col">{{ translate("message.toolEvent") }}</th>
                <th scope="col" class="is-num">
                  {{ translate("message.executionReportToolCalls") }}
                </th>
                <th scope="col" class="is-num">{{ translate("message.executionReportErrors") }}</th>
                <th scope="col">{{ translate("message.executionReportTotalDuration") }}</th>
                <th scope="col" class="is-num">
                  {{ translate("message.executionReportAvgDuration") }}
                </th>
                <th scope="col" class="is-num">
                  {{ translate("message.executionReportMaxDuration") }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tool in view.tools" :key="tool.tool">
                <td class="execution-report-tool-name">{{ tool.tool }}</td>
                <td class="is-num">{{ tool.calls }}</td>
                <td class="is-num" :class="{ 'execution-report-failed': tool.failures }">
                  {{ tool.failures }}
                </td>
                <td>
                  <span class="execution-report-bar-cell">
                    <span class="execution-report-bar" aria-hidden="true">
                      <span
                        class="execution-report-bar-fill"
                        :style="barStyle(tool.totalRatio)"
                      ></span>
                    </span>
                    <span class="execution-report-bar-text">{{ tool.totalDuration }}</span>
                  </span>
                </td>
                <td class="is-num">{{ tool.avgDuration }}</td>
                <td class="is-num">{{ tool.maxDuration }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="view.slowest.length" class="execution-report-section">
        <BaseSectionHeader :title="translate('message.executionReportSlowestSection')" />
        <ol
          class="execution-report-slowest execution-report-panel"
          data-testid="execution-report-slowest"
        >
          <li v-for="call in view.slowest" :key="call.key">
            <span class="execution-report-tool-name">{{ call.tool }}</span>
            <span class="execution-report-bar" aria-hidden="true">
              <span
                class="execution-report-bar-fill"
                :data-tone="call.success ? undefined : 'error'"
                :style="barStyle(call.ratio)"
              ></span>
            </span>
            <span
              class="execution-report-bar-text"
              :class="{ 'execution-report-failed': !call.success }"
            >
              {{ call.duration }}
            </span>
          </li>
        </ol>
      </section>
    </div>
  </el-drawer>
</template>

<style scoped>
.execution-report-body {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-lg);
  padding: var(--noobot-space-md) var(--noobot-space-lg);
}
.execution-report-section {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-sm);
  min-width: 0;
}
.execution-report-panel,
.execution-report-card {
  padding: var(--noobot-space-md);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  background: var(--noobot-surface-soft);
}
.execution-report-overview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--noobot-space-md);
}
.execution-report-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--noobot-space-sm);
}
.execution-report-card {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-2xs);
}
.execution-report-card-value {
  font-size: var(--noobot-font-size-xl);
  font-weight: var(--noobot-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.execution-report-card-label,
.execution-report-meta dt,
.execution-report-table th {
  font-size: var(--noobot-font-size-xs);
  color: var(--noobot-thinking-muted);
}
.execution-report-card[data-tone="error"],
.execution-report-error {
  border: 1px solid var(--noobot-preview-danger-border);
  background: var(--noobot-danger-soft);
}
.execution-report-card[data-tone="error"] .execution-report-card-value,
.execution-report-error,
.execution-report-failed {
  color: var(--noobot-status-error);
}
.execution-report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--noobot-space-md);
}
.execution-report-meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--noobot-space-xs) var(--noobot-space-md);
  margin: 0;
}
.execution-report-meta dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}
.execution-report-error {
  margin: 0;
  padding: var(--noobot-space-sm) var(--noobot-space-md);
  border-radius: var(--noobot-radius-md);
  word-break: break-word;
}
.execution-report-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
[data-tone="success"] {
  --execution-report-tone: var(--noobot-status-success);
}
[data-tone="warning"] {
  --execution-report-tone: var(--noobot-status-warning);
}
[data-tone="error"] {
  --execution-report-tone: var(--noobot-status-error);
}
[data-tone="idle"] {
  --execution-report-tone: var(--noobot-status-idle);
}
.execution-report-status,
.execution-report-chip {
  color: var(--execution-report-tone);
  border-color: color-mix(in srgb, var(--execution-report-tone) 40%, transparent);
  background: color-mix(in srgb, var(--execution-report-tone) 12%, transparent);
  font-weight: var(--noobot-font-weight-medium);
}
.execution-report-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--noobot-space-xs);
}
.execution-report-table-wrap {
  padding: 0;
  overflow-x: auto;
}
.execution-report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--noobot-font-size-xs);
}
.execution-report-table th,
.execution-report-table td {
  padding: var(--noobot-space-xs) var(--noobot-space-md);
  border-bottom: 1px solid var(--noobot-divider);
  text-align: left;
  white-space: nowrap;
}
.execution-report-table tbody tr:last-child td {
  border-bottom: none;
}
.execution-report-table .is-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.execution-report-bar-cell {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-sm);
  min-width: 140px;
}
.execution-report-bar {
  flex: 1;
  height: 6px;
  min-width: 48px;
  border-radius: var(--noobot-radius-pill);
  background: var(--noobot-panel-muted);
  overflow: hidden;
}
.execution-report-bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--noobot-accent);
}
.execution-report-bar-fill[data-tone="error"] {
  background: var(--noobot-status-error);
}
.execution-report-bar-text {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.execution-report-slowest {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-sm);
  margin: 0;
  list-style: none;
}
.execution-report-slowest li {
  display: grid;
  grid-template-columns: minmax(80px, max-content) 1fr max-content;
  align-items: center;
  gap: var(--noobot-space-md);
}
@media (max-width: 768px) {
  .execution-report-body {
    padding: var(--noobot-space-sm);
  }
}
</style>
