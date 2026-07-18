<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, watch, nextTick, ref } from "vue";
import { renderMermaidInElement } from "../utils/mermaid-renderer";
import { useLocale } from "../i18n/useLocale";

const props = defineProps({
  contentType: { type: String, default: "file" }, // file | attachment
  active: { type: Boolean, default: false },
  attachmentPreviewType: { type: String, default: "" },
  attachmentPreviewUrl: { type: String, default: "" },
  attachmentPreviewName: { type: String, default: "" },
  attachmentPreviewLoading: { type: Boolean, default: false },
  attachmentPreviewError: { type: String, default: "" },
  attachmentPreviewTextContent: { type: String, default: "" },
  previewLoading: { type: Boolean, default: false },
  previewError: { type: String, default: "" },
  previewFileName: { type: String, default: "" },
  previewMode: { type: String, default: "text" },
  previewTextContent: { type: String, default: "" },
  previewImageUrl: { type: String, default: "" },
  renderMarkdown: { type: Function, required: true },
});

const emit = defineEmits(["copy-markdown-rich", "copy-markdown-text"]);
const { translate } = useLocale();
const markdownContainerRef = ref(null);
const isAttachment = computed(() => props.contentType === "attachment");
const resolvedLoading = computed(() =>
  isAttachment.value ? props.attachmentPreviewLoading : props.previewLoading,
);
const resolvedError = computed(() =>
  isAttachment.value ? props.attachmentPreviewError : props.previewError,
);
const resolvedPreviewMode = computed(() =>
  isAttachment.value ? props.attachmentPreviewType || "text" : props.previewMode || "text",
);
const resolvedPreviewText = computed(() =>
  isAttachment.value ? props.attachmentPreviewTextContent : props.previewTextContent,
);
const resolvedPreviewUrl = computed(() =>
  isAttachment.value ? props.attachmentPreviewUrl : props.previewImageUrl,
);
const resolvedPreviewName = computed(() =>
  isAttachment.value ? props.attachmentPreviewName : props.previewFileName,
);
const showCopyActions = computed(
  () => resolvedPreviewMode.value === "markdown" && !resolvedLoading.value && !resolvedError.value,
);

function emitCopyMarkdownRich() {
  if (!markdownContainerRef.value) return;
  emit("copy-markdown-rich", String(markdownContainerRef.value.innerHTML || ""));
}

watch(
  () => [props.active, resolvedPreviewText.value, resolvedPreviewMode.value],
  async ([active, content, mode]) => {
    const isMarkdown = mode === "markdown" && Boolean(content);
    if (!active || !isMarkdown) return;
    await nextTick();
    try {
      await renderMermaidInElement(markdownContainerRef.value);
    } catch (error) {
      console.error("Mermaid render failed:", error);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="preview-body noobot-preview-surface" v-loading="resolvedLoading">
    <div v-if="showCopyActions" class="preview-copy-actions">
      <el-button size="small" type="primary" plain @click="emitCopyMarkdownRich">{{
        translate("message.copyFormat")
      }}</el-button>
      <el-button size="small" @click="emit('copy-markdown-text')">{{
        translate("message.copyText")
      }}</el-button>
    </div>
    <div v-if="resolvedError" class="preview-error noobot-error-surface is-preview">{{ resolvedError }}</div>
    <img
      v-else-if="resolvedPreviewMode === 'image' && resolvedPreviewUrl"
      :src="resolvedPreviewUrl"
      :alt="resolvedPreviewName"
      class="preview-image"
    />
    <video
      v-else-if="resolvedPreviewMode === 'video' && resolvedPreviewUrl"
      class="preview-video"
      :src="resolvedPreviewUrl"
      controls
      autoplay
    />
    <audio
      v-else-if="resolvedPreviewMode === 'audio' && resolvedPreviewUrl"
      class="preview-audio"
      :src="resolvedPreviewUrl"
      controls
      autoplay
    />
    <div
      v-else-if="resolvedPreviewMode === 'markdown'"
      ref="markdownContainerRef"
      class="preview-markdown noobot-rich-content"
      v-html="renderMarkdown(resolvedPreviewText)"
    />
    <pre v-else class="preview-text">{{ resolvedPreviewText }}</pre>
  </div>
</template>

<style scoped>
.preview-body {
  min-height: 240px;
  max-height: 68vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 24px;
  transition: padding 0.3s ease, max-height 0.3s ease;
}

.preview-body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.preview-body::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--noobot-panel-border) 90%, var(--noobot-text-muted));
  border-radius: var(--noobot-radius-xs);
}
.preview-body::-webkit-scrollbar-thumb:hover {
  background: var(--noobot-text-secondary);
}
.preview-body::-webkit-scrollbar-track {
  background: transparent;
}

.preview-error {
  padding: 12px;
}

.preview-copy-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--noobot-divider);
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
  margin: 0 auto;
  display: block;
  border-radius: var(--noobot-radius-xs);
  box-shadow: none;
}

.preview-video {
  width: 100%;
  max-height: 60vh;
  display: block;
  border-radius: var(--noobot-radius-xs);
  background: var(--noobot-msg-code-block-bg);
}

.preview-audio {
  width: 100%;
  display: block;
}

.preview-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--noobot-preview-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--noobot-font-size-base);
  line-height: 1.6;
}

.preview-markdown {
  color: var(--noobot-preview-text);
  font-size: var(--noobot-font-size-lg);
  line-height: 1.7;
  word-wrap: break-word;
}

.preview-markdown :deep(p) {
  margin-top: 0;
  margin-bottom: 16px;
}
.preview-markdown :deep(a) {
}
.preview-markdown :deep(a:hover) {
}
.preview-markdown :deep(hr) {
  margin: 24px 0;
}

.preview-markdown :deep(h1),
.preview-markdown :deep(h2),
.preview-markdown :deep(h3),
.preview-markdown :deep(h4),
.preview-markdown :deep(h5),
.preview-markdown :deep(h6) {
  margin-top: 24px;
  margin-bottom: 16px;
}
.preview-markdown :deep(h1) {
  font-size: var(--noobot-font-size-lg);
}
.preview-markdown :deep(h2) {
  font-size: var(--noobot-font-size-lg);
}
.preview-markdown :deep(h3) {
  font-size: var(--noobot-font-size-md);
}
.preview-markdown :deep(h4) {
  font-size: var(--noobot-font-size-md);
}

.preview-markdown :deep(blockquote) {
  margin: 16px 0;
  padding: 12px 16px;
  color: var(--noobot-preview-text);
  border-radius: 0 6px 6px 0;
  font-style: italic;
}
.preview-markdown :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

.preview-markdown :deep(ul),
.preview-markdown :deep(ol) {
  margin-top: 0;
  margin-bottom: 16px;
  padding-left: 2em;
}
.preview-markdown :deep(li) {
  margin: 4px 0;
}
.preview-markdown :deep(li > p) {
  margin-top: 16px;
}
.preview-markdown :deep(ul li::marker) {
}
.preview-markdown :deep(ol li::marker) {
}

.preview-markdown :deep(code) {
  padding: 0.2em 0.4em;
  font-size: var(--noobot-font-size-sm);
}

.preview-markdown :deep(pre) {
  padding: 12px;
  margin-bottom: 16px;
}
.preview-markdown :deep(pre code) {
  font-size: var(--noobot-font-size-sm);
}

.preview-markdown :deep(table) {
  margin-bottom: 16px;
  font-size: var(--noobot-font-size-base);
}
.preview-markdown :deep(th),
.preview-markdown :deep(td) {
  padding: 10px 14px;
}
.preview-markdown :deep(th) {
  color: var(--noobot-preview-text);
}
.preview-markdown :deep(tr:nth-child(even)) {
}
.preview-markdown :deep(tr:hover) {
  background-color: var(--noobot-accent-soft);
}

.preview-markdown :deep(.mermaid) {
  margin: 20px 0;
  padding: 12px;
  overflow-x: auto;
  display: flex;
  justify-content: center;
}
.preview-markdown :deep(.mermaid svg) {
  max-width: 100%;
  height: auto;
  display: block;
}
.preview-markdown :deep(.mermaid-render-error) {
  padding: 12px;
}
</style>
