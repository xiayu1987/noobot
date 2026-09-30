<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useMermaidRender } from "../composables/useMermaidRender.js";
import {
  attachmentIdentityKey,
  parseAttachmentIdentityRef,
} from "@noobot/attachment-protocol/identity";

const props = defineProps({
  content: { type: String, default: "" },
  renderMarkdown: { type: Function, required: true },
  attachmentRefIndex: { type: Map, default: null },
});
const emit = defineEmits(["download-workspace-file", "download-attachment"]);

const { mermaidHostRef } = useMermaidRender();
const renderedHtml = computed(() =>
  props.renderMarkdown(String(props.content || ""), {
    attachmentRefIndex: props.attachmentRefIndex,
    workspaceFileLinks: true,
  }),
);

function handleFileLink(event) {
  const link = event.target?.closest?.(
    "a[data-noobot-workspace-path], a[data-noobot-attachment-ref]",
  );
  if (!link || !event.currentTarget?.contains(link)) return;
  event.preventDefault();
  if (event.type === "auxclick") return;
  const attachmentRef = link.getAttribute("data-noobot-attachment-ref");
  if (attachmentRef) {
    let identity;
    try {
      identity = parseAttachmentIdentityRef(attachmentRef);
    } catch {
      return;
    }
    const key = attachmentIdentityKey(identity);
    const attachment = props.attachmentRefIndex?.get(key);
    if (attachment) emit("download-attachment", attachment);
    return;
  }
  emit("download-workspace-file", link.getAttribute("data-noobot-workspace-path"));
}

function getHtml() {
  return String(mermaidHostRef.value?.innerHTML || "");
}

defineExpose({ getHtml });
</script>

<template>
  <div
    ref="mermaidHostRef"
    class="base-markdown-content noobot-rich-content"
    @click="handleFileLink"
    @auxclick="handleFileLink"
    v-html="renderedHtml"
  />
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

.base-markdown-content :deep(code) {
  padding: var(--noobot-space-3xs) var(--noobot-space-xs);
  font-size: var(--noobot-font-size-sm);
}

.base-markdown-content :deep(pre) {
  padding: var(--noobot-msg-markdown-pre-padding);
  margin: var(--noobot-space-md) 0;
}

.base-markdown-content :deep(pre code) {
  padding: 0;
  font-size: var(--noobot-font-size-sm);
}

.base-markdown-content :deep(ul),
.base-markdown-content :deep(ol) {
  margin: var(--noobot-space-2xs) 0 var(--noobot-space-sm) 0;
  padding-left: var(--noobot-space-xl);
}

.base-markdown-content :deep(li) {
  margin: var(--noobot-space-3xs) 0;
  line-height: var(--noobot-line-height-body);
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
}

.base-markdown-content :deep(.noobot-collapse) {
  margin: var(--noobot-space-md) 0;
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  background: color-mix(in srgb, var(--noobot-panel-muted) 68%, transparent);
  overflow: hidden;
}

.base-markdown-content :deep(.noobot-collapse > summary) {
  cursor: pointer;
  user-select: none;
  padding: var(--noobot-space-sm) var(--noobot-space-md);
  font-weight: var(--noobot-font-weight-bold);
  color: var(--noobot-text-main);
  background: color-mix(in srgb, var(--noobot-accent-soft) 70%, transparent);
  border-bottom: 1px solid transparent;
}

.base-markdown-content :deep(.noobot-collapse[open] > summary) {
  border-bottom-color: var(--noobot-panel-border);
}

.base-markdown-content :deep(.noobot-collapse__body) {
  padding: var(--noobot-space-md);
}

.base-markdown-content :deep(.noobot-collapse__body > :first-child) {
  margin-top: 0;
}

.base-markdown-content :deep(.noobot-collapse__body > :last-child) {
  margin-bottom: 0;
}

.base-markdown-content :deep(h1),
.base-markdown-content :deep(h2),
.base-markdown-content :deep(h3),
.base-markdown-content :deep(h4) {
  margin: var(--noobot-space-md) 0 var(--noobot-space-sm);
  line-height: var(--noobot-line-height-cozy);
}

.base-markdown-content :deep(.mermaid svg) {
  max-width: 100%;
  height: auto;
  display: block;
}

.base-markdown-content :deep(.noobot-attachment-chip) {
  display: inline-flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  max-width: 100%;
  padding: var(--noobot-space-3xs) var(--noobot-space-sm);
  border: 1px solid var(--noobot-msg-file-card-border);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-msg-file-card-bg);
  font-size: var(--noobot-font-size-sm);
  line-height: var(--noobot-line-height-comfortable);
  text-decoration: none;
  vertical-align: baseline;
}

.base-markdown-content :deep(a.noobot-attachment-chip:hover) {
  background: var(--noobot-accent-soft);
}

.base-markdown-content :deep(.noobot-attachment-chip__name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-markdown-content :deep(.noobot-attachment-chip--missing) {
  opacity: 0.6;
  cursor: not-allowed;
  text-decoration: line-through;
}
</style>
