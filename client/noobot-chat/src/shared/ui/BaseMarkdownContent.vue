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
  <div ref="mermaidHostRef" class="base-markdown-content" v-html="renderedHtml" />
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
  background: var(--noobot-msg-inline-code-bg);
  padding: 2px 6px;
  border-radius: var(--noobot-radius-xs);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  color: var(--noobot-msg-inline-code-text);
}

.base-markdown-content :deep(pre) {
  background: var(--noobot-msg-code-block-bg);
  color: var(--noobot-msg-code-block-text);
  padding: var(--noobot-msg-markdown-pre-padding);
  border-radius: var(--noobot-radius-md);
  border: 1px solid var(--noobot-panel-border);
  box-shadow: none;
  overflow-x: auto;
  margin: var(--noobot-space-md) 0;
}

.base-markdown-content :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
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
  width: 100%;
  border-collapse: collapse;
  margin: var(--noobot-space-md) 0;
  font-size: var(--noobot-msg-caption-font-size);
  border: 1px solid var(--noobot-msg-assistant-border);
  border-radius: var(--noobot-radius-sm);
  overflow: hidden;
}

.base-markdown-content :deep(th),
.base-markdown-content :deep(td) {
  border: 1px solid var(--noobot-msg-assistant-border);
  padding: var(--noobot-msg-table-cell-padding-y) var(--noobot-msg-table-cell-padding-x);
  text-align: left;
  vertical-align: top;
}

.base-markdown-content :deep(th) {
  background: var(--noobot-panel-muted);
  font-weight: 600;
}

.base-markdown-content :deep(tr:nth-child(even) td) {
  background: color-mix(in srgb, var(--noobot-panel-muted) 62%, transparent);
}

.base-markdown-content :deep(.mermaid) {
  margin: var(--noobot-space-md) 0;
  padding: var(--noobot-space-sm);
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  background: var(--noobot-panel-bg);
  overflow-x: auto;
}

.base-markdown-content :deep(blockquote) {
  margin: var(--noobot-space-md) 0;
  padding: var(--noobot-space-xs) var(--noobot-space-md);
  border-left: 3px solid color-mix(in srgb, var(--noobot-text-accent) 90%, transparent);
  background: var(--noobot-accent-soft);
  border-radius: var(--noobot-radius-xs);
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
