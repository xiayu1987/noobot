<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, watch, nextTick, ref } from "vue";
import { CopyDocument, Memo } from "@element-plus/icons-vue";
import { renderMermaidInElement } from "../utils/mermaid-renderer.js";
import { useLocale } from "../i18n/useLocale.js";

const props = defineProps({
  contentType: { type: String, default: "file" },
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
    <div v-if="showCopyActions" class="preview-copy-actions noobot-copy-actions">
      <el-tooltip :content="translate('message.copyFormat')" placement="top" :show-after="300">
        <el-button
          size="small"
          class="noobot-icon-button noobot-flat-inline-icon-btn noobot-copy-button"
          :aria-label="translate('message.copyFormat')"
          @click="emit('copy-markdown-rich')"
        >
          <el-icon><CopyDocument /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip :content="translate('message.copyText')" placement="top" :show-after="300">
        <el-button
          size="small"
          class="noobot-icon-button noobot-flat-inline-icon-btn noobot-copy-button"
          :aria-label="translate('message.copyText')"
          @click="emit('copy-markdown-text')"
        >
          <el-icon><Memo /></el-icon>
        </el-button>
      </el-tooltip>
    </div>
    <div v-if="resolvedError" class="preview-error noobot-error-surface is-preview">
      {{ resolvedError }}
    </div>
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
  overflow-x: hidden;
}

.preview-error {
  padding: var(--noobot-space-md);
}

.preview-copy-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--noobot-space-xl);
  padding-bottom: var(--noobot-space-md);
  border-bottom: 1px solid var(--noobot-divider);
}

.preview-video {
  width: 100%;
  max-height: 100%;
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
  font-family: var(--noobot-font-mono);
  font-size: var(--noobot-font-size-md);
  line-height: var(--noobot-line-height-body);
}

.preview-markdown {
  color: var(--noobot-preview-text);
}
</style>
