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
});

const emit = defineEmits(["toggle"]);
const resolvedTitle = computed(() => props.titleText || props.contentText || "");

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
    <span
      class="base-thinking-log-line__text"
      :class="{ 'is-expandable': expandable, 'is-expanded': expanded }"
      :title="resolvedTitle"
      @click="handleToggle"
    >
      {{ contentText }}
    </span>
  </div>
</template>

<style scoped>
.base-thinking-log-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--noobot-msg-caption-font-size);
  color: var(--noobot-thinking-text);
  margin-bottom: 6px;
  padding-left: var(--noobot-space-sm);
  border-left: 2px solid var(--noobot-thinking-line-border);
}
.base-thinking-log-line.is-tool {
  border-left-color: var(--noobot-thinking-tool-border);
}
.base-thinking-log-line__prefix {
  flex: 0 0 auto;
  color: var(--noobot-thinking-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
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
.base-thinking-log-line__text.is-expanded {
  overflow: visible;
  text-overflow: unset;
  white-space: normal;
  word-break: break-word;
}
</style>
