<script setup>
import { watch, nextTick, ref } from "vue";
import { renderMermaidInElement } from "../utils/mermaid-renderer";

const props = defineProps({
  contentType: { type: String, default: "file" }, // file | attachment
  active: { type: Boolean, default: false },
  attachmentPreviewType: { type: String, default: "" },
  attachmentPreviewUrl: { type: String, default: "" },
  attachmentPreviewName: { type: String, default: "" },
  previewLoading: { type: Boolean, default: false },
  previewError: { type: String, default: "" },
  previewFileName: { type: String, default: "" },
  previewMode: { type: String, default: "text" },
  previewTextContent: { type: String, default: "" },
  previewImageUrl: { type: String, default: "" },
  renderMarkdown: { type: Function, required: true },
});

const emit = defineEmits(["copy-markdown-rich", "copy-markdown-text"]);
const markdownContainerRef = ref(null);

function emitCopyMarkdownRich() {
  emit("copy-markdown-rich", String(markdownContainerRef.value?.innerHTML || ""));
}

watch(
  () => [props.active, props.contentType, props.previewTextContent, props.previewMode],
  async ([active, contentType, content, mode]) => {
    if (!active || contentType !== "file" || mode !== "markdown" || !content) return;
    await nextTick();
    try {
      await renderMermaidInElement(markdownContainerRef.value);
    } catch (error) {
      console.error("Mermaid 渲染失败:", error);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="preview-body" v-loading="contentType === 'file' && previewLoading">
    <template v-if="contentType === 'attachment'">
      <img
        v-if="attachmentPreviewType === 'image' && attachmentPreviewUrl"
        :src="attachmentPreviewUrl"
        :alt="attachmentPreviewName"
        class="preview-image"
      />
      <video
        v-else-if="attachmentPreviewType === 'video' && attachmentPreviewUrl"
        class="preview-video"
        :src="attachmentPreviewUrl"
        controls
        autoplay
      />
    </template>

    <template v-else>
      <div
        v-if="previewMode === 'markdown' && !previewLoading && !previewError"
        class="preview-copy-actions"
      >
        <el-button size="small" @click="emitCopyMarkdownRich">格式复制</el-button>
        <el-button size="small" @click="emit('copy-markdown-text')">文本复制</el-button>
      </div>
      <div v-if="previewError" class="preview-error">{{ previewError }}</div>
      <img
        v-else-if="previewMode === 'image' && previewImageUrl"
        :src="previewImageUrl"
        :alt="previewFileName"
        class="preview-image"
      />
      <div
        v-else-if="previewMode === 'markdown'"
        ref="markdownContainerRef"
        class="preview-markdown"
        v-html="renderMarkdown(previewTextContent)"
      />
      <pre v-else class="preview-text">{{ previewTextContent }}</pre>
    </template>
  </div>
</template>

<style scoped>
.preview-body {
  min-height: 240px;
  max-height: 68vh;
  overflow: auto;
  background: #ffffff;
  border: 1px solid #dbe3f0;
  border-radius: 10px;
  padding: 14px;
}

.preview-error {
  color: #fca5a5;
}

.preview-copy-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.preview-image {
  max-width: 100%;
  max-height: 62vh;
  margin: 0 auto;
  display: block;
  border-radius: 8px;
}

.preview-video {
  width: 100%;
  max-height: 62vh;
  display: block;
  border-radius: 8px;
}

.preview-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #111827;
  font-size: 13px;
  line-height: 1.6;
  background: #ffffff;
}

.preview-markdown {
  color: #111827;
  font-size: 13px;
  background: #ffffff;
}

.preview-markdown :deep(code) {
  background: #f3f4f6;
  color: #111827;
  padding: 2px 6px;
  border-radius: 4px;
}

.preview-markdown :deep(pre) {
  background: #f8fafc;
  color: #111827;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
}

.preview-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}

.preview-markdown :deep(ul),
.preview-markdown :deep(ol) {
  margin: 8px 0 12px 20px;
  padding-left: 16px;
}

.preview-markdown :deep(li) {
  margin: 4px 0;
  line-height: 1.7;
}

.preview-markdown :deep(ul li::marker) {
  color: #60a5fa;
}

.preview-markdown :deep(ol li::marker) {
  color: #93c5fd;
  font-weight: 600;
}

.preview-markdown :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
  border: 1px solid var(--noobot-msg-assistant-border, #e5e7eb);
}

.preview-markdown :deep(th),
.preview-markdown :deep(td) {
  border: 1px solid var(--noobot-msg-assistant-border, #e5e7eb);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

.preview-markdown :deep(th) {
  background: rgba(148, 163, 184, 0.15);
  font-weight: 600;
}

.preview-markdown :deep(tr:nth-child(even) td) {
  background: rgba(148, 163, 184, 0.08);
}

.preview-markdown :deep(.mermaid) {
  margin: 12px 0;
  padding: 10px;
  border: 1px solid var(--noobot-msg-assistant-border, #e5e7eb);
  border-radius: 8px;
  background: #ffffff;
  overflow-x: auto;
}

.preview-markdown :deep(.mermaid svg) {
  max-width: 100%;
  height: auto;
  display: block;
}

.preview-markdown :deep(.mermaid-render-error) {
  color: #b91c1c;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  border-radius: 8px;
  padding: 10px;
  white-space: pre-wrap;
}
</style>
