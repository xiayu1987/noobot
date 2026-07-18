<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  eventText: { type: String, default: "" },
  contentText: { type: String, default: "" },
  prefixText: { type: String, default: "" },
  indent: { type: Number, default: 0 },
  tool: { type: Boolean, default: false },
  expandable: { type: Boolean, default: false },
  expanded: { type: Boolean, default: false },
  titleText: { type: String, default: "" },
  detailText: { type: [String, Object, Array], default: "" },
});

const emit = defineEmits(["toggle"]);
const eventLabel = computed(() => {
  if (!props.tool) return "";
  const eventName = String(props.eventText || "").trim().toLowerCase();
  if (eventName === "tool_call") return "调用";
  if (eventName === "tool_result") return "返回";
  return "工具";
});
const contentWithoutEventPrefix = computed(() => {
  const content = String(props.contentText || "");
  if (!props.tool) return content;
  const eventName = String(props.eventText || "").trim().toLowerCase();
  const prefix = eventName === "tool_call"
    ? /^(?:调用|call)\s*[:：]?\s*/i
    : eventName === "tool_result"
      ? /^(?:返回|return)\s*[:：]?\s*/i
      : null;
  return prefix ? content.replace(prefix, "") : content;
});
const resolvedTitle = computed(() => props.titleText || contentWithoutEventPrefix.value || "");
const resolvedDetail = computed(() => {
  if (typeof props.detailText === "string") {
    return props.detailText || contentWithoutEventPrefix.value;
  }
  try {
    return JSON.stringify(props.detailText, null, 2);
  } catch {
    return String(props.detailText || contentWithoutEventPrefix.value || "");
  }
});

function handleToggle() {
  if (!props.expandable) return;
  emit("toggle");
}
</script>

<template>
  <div
    class="base-thinking-log-line"
    :class="{ 'is-tool': tool }"
    :style="{ marginLeft: `${Math.max(0, Number(indent || 0))}px` }"
  >
    <span v-if="prefixText" class="base-thinking-log-line__prefix">{{ prefixText }}</span>
    <span v-if="eventLabel" class="base-thinking-log-line__event" :class="`is-${String(eventText).toLowerCase()}`">{{ eventLabel }}</span>
    <span
      class="base-thinking-log-line__text"
      :class="{ 'is-expandable': expandable }"
      :title="resolvedTitle"
      @click="handleToggle"
    >
      {{ contentWithoutEventPrefix }}
    </span>
    <pre
      v-if="expanded && resolvedDetail"
      class="base-thinking-log-line__detail"
    >{{ resolvedDetail }}</pre>
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
.base-thinking-log-line.is-tool {
  border-left-color: var(--noobot-thinking-tool-border);
}
.base-thinking-log-line__prefix {
  flex: 0 0 auto;
  color: var(--noobot-thinking-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
.base-thinking-log-line__event {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: var(--noobot-thinking-log-event-radius);
  color: var(--noobot-thinking-muted);
  background: var(--noobot-thinking-detail-background, rgba(127, 127, 127, 0.08));
  font-weight: 600;
}
.base-thinking-log-line__event.is-tool-call {
  color: var(--el-color-primary);
}
.base-thinking-log-line__event.is-tool-result {
  color: var(--el-color-success);
}
.base-thinking-log-line__text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.base-thinking-log-line__text.is-expandable {
  cursor: pointer;
}
</style>
