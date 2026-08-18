<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { ElIcon } from "element-plus";
import { normalizeSecurityRiskLevel } from "@noobot/security-assessment-protocol";
import { useLocale } from "../i18n/useLocale.js";
import { resolveToolEventVisual } from "../utils/toolEventIcon.js";

const props = defineProps({
  eventText: { type: String, default: "" },
  contentText: { type: String, default: "" },
  prefixText: { type: String, default: "" },
  indent: { type: Number, default: 0 },
  tool: { type: Boolean, default: false },
  tone: { type: String, default: "" },
  expandable: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  titleText: { type: String, default: "" },
  detailText: { type: [String, Object, Array], default: "" },
  detailValue: { type: null, default: undefined },
  toolName: { type: String, default: "" },
  riskLevel: { type: String, default: "" },
});

const emit = defineEmits(["toggle"]);
const { translate } = useLocale();
const eventLabel = computed(() => {
  if (!props.tool) return "";
  const eventName = String(props.eventText || "")
    .trim()
    .toLowerCase();
  if (eventName === "tool_call") return translate("message.toolCallEvent");
  if (eventName === "tool_result") return translate("message.toolResultEvent");
  return translate("message.toolEvent");
});
const eventClass = computed(() => {
  const eventName = String(props.eventText || "")
    .trim()
    .toLowerCase();
  if (eventName === "tool_call") return "is-tool-call";
  if (eventName === "tool_result") return "is-tool-result";
  return "is-tool-event";
});
const eventVisual = computed(() =>
  resolveToolEventVisual({
    event: props.eventText,
    toolName: props.toolName,
    tone: props.tone,
  }),
);
const contentWithoutEventPrefix = computed(() => {
  const content = String(props.contentText || "");
  if (!props.tool) return content;
  const eventName = String(props.eventText || "")
    .trim()
    .toLowerCase();
  const prefix =
    eventName === "tool_call"
      ? /^(?:调用|call)\s*[:：]?\s*/i
      : eventName === "tool_result"
        ? /^(?:返回|return)\s*[:：]?\s*/i
        : null;
  return prefix ? content.replace(prefix, "") : content;
});
const normalizedRiskLevel = computed(() => normalizeSecurityRiskLevel(props.riskLevel));
const riskLabel = computed(() =>
  normalizedRiskLevel.value ? translate(`message.toolRiskLevel.${normalizedRiskLevel.value}`) : "",
);
const contentWithoutToolName = computed(() => {
  const content = contentWithoutEventPrefix.value;
  const toolName = String(props.toolName || "").trim();
  if (!toolName || !content.startsWith(toolName)) return content;
  const boundary = content.charAt(toolName.length);
  if (boundary && !/[\s·:：([]/.test(boundary)) return content;
  return content.slice(toolName.length).trimStart();
});
const resolvedTitle = computed(() => props.titleText || contentWithoutEventPrefix.value || "");
const resolvedDetail = computed(() => {
  if (props.detailText !== "" && props.detailText !== undefined && props.detailText !== null) {
    if (typeof props.detailText === "string") return props.detailText;
    try {
      return JSON.stringify(props.detailText, null, 2);
    } catch {
      return String(props.detailText || "");
    }
  }
  const source = props.detailValue === undefined ? contentWithoutEventPrefix.value : props.detailValue;
  try {
    return typeof source === "string" ? source : JSON.stringify(source, null, 2);
  } catch {
    return String(source || "");
  }
});
const hasDetail = computed(
  () =>
    (props.detailText !== "" && props.detailText !== undefined && props.detailText !== null) ||
    props.detailValue !== undefined ||
    props.expandable,
);

function handleToggle() {
  if (!props.expandable) return;
  emit("toggle");
}
</script>

<template>
  <div
    class="base-thinking-log-line"
    :class="{ 'is-tool': tool, 'is-tool-result-failed': tone === 'error' }"
    :style="{ marginLeft: `${Math.max(0, Number(indent || 0))}px` }"
  >
    <span v-if="prefixText" class="base-thinking-log-line__prefix">{{ prefixText }}</span>
    <span
      v-if="eventLabel"
      class="base-thinking-log-line__event"
      :class="[eventClass, { 'is-tool-result-failed': eventClass === 'is-tool-result' && tone === 'error' }]"
      :title="eventLabel"
      :aria-label="eventLabel"
      :data-icon-kind="eventVisual.key"
      ><ElIcon aria-hidden="true"><component :is="eventVisual.icon" /></ElIcon
      ><span class="base-thinking-log-line__event-label">{{ eventLabel }}</span></span
    >
    <span
      class="base-thinking-log-line__text"
      :class="{ 'is-expandable': expandable }"
      :title="resolvedTitle"
      @click="handleToggle"
    >
      <span v-if="toolName" class="base-thinking-log-line__tool-name">{{ toolName }}</span>
      <span
        v-if="riskLabel"
        class="base-thinking-log-line__risk"
        :class="`is-${normalizedRiskLevel}`"
        >{{ riskLabel }}</span
      >
      <span v-if="contentWithoutToolName" class="base-thinking-log-line__summary">{{
        contentWithoutToolName
      }}</span>
    </span>
    <pre v-if="expanded && hasDetail && resolvedDetail" class="base-thinking-log-line__detail">{{
      resolvedDetail
    }}</pre>
  </div>
</template>

<style scoped>
.base-thinking-log-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  font-size: var(--noobot-msg-caption-font-size);
  color: var(--noobot-thinking-text);
  margin-bottom: 6px;
  padding-left: var(--noobot-space-sm);
  border-left: 2px solid var(--noobot-thinking-line-border);
}
.base-thinking-log-line__detail {
  flex: 0 0 calc(100% - var(--noobot-space-sm));
  margin: 2px 0 2px var(--noobot-space-sm);
  padding: var(--noobot-space-sm);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: var(--noobot-thinking-log-detail-radius);
  background: var(--noobot-thinking-detail-background, rgba(127, 127, 127, 0.08));
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;
}
.base-thinking-log-line.is-tool {
  border-left-color: var(--noobot-thinking-tool-border);
}
.base-thinking-log-line.is-tool-result-failed {
  border-left-color: var(--noobot-status-error);
  color: var(--noobot-status-error);
}
.base-thinking-log-line__prefix {
  flex: 0 0 auto;
  color: var(--noobot-thinking-muted);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;
}
.base-thinking-log-line__event {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  color: var(--noobot-thinking-muted);
  font-size: 15px;
}
.base-thinking-log-line__event.is-tool-call {
  color: var(--el-color-primary);
}
.base-thinking-log-line__event.is-tool-result {
  color: var(--el-color-success);
}
.base-thinking-log-line__event.is-tool-result-failed {
  color: var(--noobot-status-error);
  background: color-mix(in srgb, var(--noobot-status-error) 12%, transparent);
}
.base-thinking-log-line__event-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.base-thinking-log-line__text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.base-thinking-log-line__tool-name {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;
  font-weight: 600;
}
.base-thinking-log-line__risk {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: var(--noobot-thinking-log-event-radius);
  background: var(--noobot-thinking-detail-background, rgba(127, 127, 127, 0.08));
  color: var(--noobot-thinking-muted);
  font-size: 0.9em;
  font-weight: 600;
}
.base-thinking-log-line__risk.is-medium {
  color: var(--el-color-warning);
}
.base-thinking-log-line__risk.is-high,
.base-thinking-log-line__risk.is-critical {
  color: var(--noobot-status-error);
  background: color-mix(in srgb, var(--noobot-status-error) 12%, transparent);
}
.base-thinking-log-line__summary {
  margin-left: 6px;
}
.base-thinking-log-line__text.is-expandable {
  cursor: pointer;
}
</style>
