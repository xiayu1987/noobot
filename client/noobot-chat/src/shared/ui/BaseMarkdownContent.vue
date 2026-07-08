<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useMermaidRender } from "../../composables/message/useMermaidRender";

const props = defineProps({
  content: { type: String, default: "" },
  renderMarkdown: { type: Function, required: true },
});

const { mermaidHostRef } = useMermaidRender();
const renderedHtml = computed(() => props.renderMarkdown(String(props.content || "")));

function getHtml() {
  return String(mermaidHostRef.value?.innerHTML || "");
}

defineExpose({ getHtml });
</script>

<template>
  <div ref="mermaidHostRef" class="base-markdown-content noobot-rich-content" v-html="renderedHtml" />
</template>

<style scoped>
.base-markdown-content {
  width: 100%;
  overflow-x: auto;
  color: inherit;
}

.base-markdown-content :deep(p) {
  margin: 0 0 var(--noobot-space-md) 0;
}

.base-markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.base-markdown-content :deep(a) {
  color: var(--noobot-msg-link);
  text-decoration: none;
  text-underline-offset: 2px;
}

.base-markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.base-markdown-content :deep(code) {
  padding: 2px 6px;
  font-size: 0.9em;
}

.base-markdown-content :deep(pre) {
  padding: var(--noobot-msg-markdown-pre-padding);
  margin: var(--noobot-space-md) 0;
}

.base-markdown-content :deep(pre code) {
  padding: 0;
  font-size: 0.9em;
}

.base-markdown-content :deep(ul),
.base-markdown-content :deep(ol) {
  margin: var(--noobot-space-xs) 0 var(--noobot-space-md) 20px;
  padding-left: 16px;
}

.base-markdown-content :deep(li) {
  margin: 4px 0;
  line-height: 1.7;
}

.base-markdown-content :deep(ul li::marker) {
  color: var(--noobot-text-accent);
}

.base-markdown-content :deep(ol li::marker) {
  color: color-mix(in srgb, var(--noobot-text-accent) 70%, var(--noobot-text-main));
  font-weight: 600;
}

.base-markdown-content :deep(table) {
  margin: var(--noobot-space-md) 0;
  font-size: var(--noobot-msg-caption-font-size);
  border-radius: var(--noobot-radius-sm);
  overflow: hidden;
}

.base-markdown-content :deep(th),
.base-markdown-content :deep(td) {
  padding: var(--noobot-msg-table-cell-padding-y) var(--noobot-msg-table-cell-padding-x);
}

.base-markdown-content :deep(th) {
}

.base-markdown-content :deep(tr:nth-child(even) td) {
  background: color-mix(in srgb, var(--noobot-panel-muted) 62%, transparent);
}

.base-markdown-content :deep(.mermaid) {
  margin: var(--noobot-space-md) 0;
  padding: var(--noobot-space-sm);
  overflow-x: auto;
}

.base-markdown-content :deep(blockquote) {
  margin: var(--noobot-space-md) 0;
  padding: var(--noobot-space-xs) var(--noobot-space-md);
  border-left: 3px solid color-mix(in srgb, var(--noobot-text-accent) 90%, transparent);
  background: var(--noobot-accent-soft);
  border-radius: var(--noobot-radius-xs);
}

.base-markdown-content :deep(.noobot-harness-collapse) {
  margin: var(--noobot-space-md) 0;
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  background: color-mix(in srgb, var(--noobot-panel-muted) 68%, transparent);
  overflow: hidden;
}

.base-markdown-content :deep(.noobot-harness-collapse > summary) {
  cursor: pointer;
  user-select: none;
  padding: var(--noobot-space-sm) var(--noobot-space-md);
  font-weight: 700;
  color: var(--noobot-text-main);
  background: color-mix(in srgb, var(--noobot-accent-soft) 70%, transparent);
  border-bottom: 1px solid transparent;
}

.base-markdown-content :deep(.noobot-harness-collapse[open] > summary) {
  border-bottom-color: var(--noobot-panel-border);
}

.base-markdown-content :deep(.noobot-harness-collapse__body) {
  padding: var(--noobot-space-md);
}

.base-markdown-content :deep(.noobot-harness-collapse__body > :first-child) {
  margin-top: 0;
}

.base-markdown-content :deep(.noobot-harness-collapse__body > :last-child) {
  margin-bottom: 0;
}

.base-markdown-content :deep(h1),
.base-markdown-content :deep(h2),
.base-markdown-content :deep(h3),
.base-markdown-content :deep(h4) {
  margin: var(--noobot-space-md) 0 var(--noobot-space-sm);
  line-height: 1.35;
  color: inherit;
}

.base-markdown-content :deep(.mermaid svg) {
  max-width: 100%;
  height: auto;
  display: block;
}
</style>
