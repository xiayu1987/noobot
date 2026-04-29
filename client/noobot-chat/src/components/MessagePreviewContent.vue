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
  if (!markdownContainerRef.value) return;
  emit("copy-markdown-rich", String(markdownContainerRef.value.innerHTML || ""));
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
    <!-- 附件预览 -->
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

    <!-- 文件预览 -->
    <template v-else>
      <div
        v-if="previewMode === 'markdown' && !previewLoading && !previewError"
        class="preview-copy-actions"
      >
        <el-button size="small" type="primary" plain @click="emitCopyMarkdownRich">格式复制</el-button>
        <el-button size="small" @click="emit('copy-markdown-text')">文本复制</el-button>
      </div>
      <div v-if="previewError" class="preview-error">{{ previewError }}</div>
      
      <img
        v-else-if="previewMode === 'image' && previewImageUrl"
        :src="previewImageUrl"
        :alt="previewFileName"
        class="preview-image"
      />
      
      <!-- Markdown 渲染区 -->
      <div
        v-else-if="previewMode === 'markdown'"
        ref="markdownContainerRef"
        class="preview-markdown"
        v-html="renderMarkdown(previewTextContent)"
      />
      
      <!-- 纯文本渲染区 -->
      <pre v-else class="preview-text">{{ previewTextContent }}</pre>
    </template>
  </div>
</template>

<style scoped>
/* ==================== 基础容器样式 ==================== */
.preview-body {
  min-height: 240px;
  max-height: 68vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  transition: all 0.3s ease;
}

/* 自定义滚动条 */
.preview-body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.preview-body::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}
.preview-body::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
.preview-body::-webkit-scrollbar-track {
  background: transparent;
}

.preview-error {
  color: #ef4444;
  background: #fef2f2;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid #fecaca;
}

.preview-copy-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f1f5f9;
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
  margin: 0 auto;
  display: block;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.preview-video {
  width: 100%;
  max-height: 60vh;
  display: block;
  border-radius: 6px;
  background: #000;
}

.preview-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  line-height: 1.6;
}

/* ==================== Markdown 核心排版样式 ==================== */
.preview-markdown {
  color: #1f2937;
  font-size: 15px;
  line-height: 1.7;
  word-wrap: break-word;
}

/* 段落与基础元素 */
.preview-markdown :deep(p) { margin-top: 0; margin-bottom: 16px; }
.preview-markdown :deep(a) { color: #3b82f6; text-decoration: none; }
.preview-markdown :deep(a:hover) { text-decoration: underline; }
.preview-markdown :deep(hr) { height: 1px; padding: 0; margin: 24px 0; background-color: #e5e7eb; border: 0; }

/* 标题 */
.preview-markdown :deep(h1), .preview-markdown :deep(h2), .preview-markdown :deep(h3),
.preview-markdown :deep(h4), .preview-markdown :deep(h5), .preview-markdown :deep(h6) {
  margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; color: #111827;
}
.preview-markdown :deep(h1) { font-size: 1.8em; padding-bottom: 0.3em; border-bottom: 1px solid #e5e7eb; }
.preview-markdown :deep(h2) { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #e5e7eb; }
.preview-markdown :deep(h3) { font-size: 1.25em; }
.preview-markdown :deep(h4) { font-size: 1em; }

/* 引用块 */
.preview-markdown :deep(blockquote) {
  margin: 16px 0; padding: 12px 16px; color: #4b5563; background-color: #f9fafb;
  border-left: 4px solid #d1d5db; border-radius: 0 6px 6px 0; font-style: italic;
}
.preview-markdown :deep(blockquote p:last-child) { margin-bottom: 0; }

/* 列表 */
.preview-markdown :deep(ul), .preview-markdown :deep(ol) { margin-top: 0; margin-bottom: 16px; padding-left: 2em; }
.preview-markdown :deep(li) { margin: 4px 0; }
.preview-markdown :deep(li > p) { margin-top: 16px; }
.preview-markdown :deep(ul li::marker) { color: #6b7280; }
.preview-markdown :deep(ol li::marker) { color: #4b5563; font-weight: 500; }

/* 行内代码 */
.preview-markdown :deep(code) {
  background-color: #f3f4f6; color: #db2777; padding: 0.2em 0.4em; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9em;
}

/* 多行代码块 */
.preview-markdown :deep(pre) {
  background-color: #1e293b; color: #e2e8f0; border-radius: 8px; padding: 16px;
  overflow-x: auto; margin-bottom: 16px;
}
.preview-markdown :deep(pre code) { background-color: transparent; color: inherit; padding: 0; font-size: 13.5px; border-radius: 0; }

/* 表格 */
.preview-markdown :deep(table) { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px; }
.preview-markdown :deep(th), .preview-markdown :deep(td) { border: 1px solid #d1d5db; padding: 10px 14px; text-align: left; }
.preview-markdown :deep(th) { background-color: #f3f4f6; font-weight: 600; color: #374151; }
.preview-markdown :deep(tr:nth-child(even)) { background-color: #f9fafb; }
.preview-markdown :deep(tr:hover) { background-color: #f3f4f6; }

/* Mermaid 图表 */
.preview-markdown :deep(.mermaid) {
  margin: 20px 0; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #ffffff; overflow-x: auto; display: flex; justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.preview-markdown :deep(.mermaid svg) { max-width: 100% !important; height: auto !important; display: block; }
.preview-markdown :deep(.mermaid-render-error) {
  color: #b91c1c; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px;
  padding: 12px; white-space: pre-wrap; font-family: monospace;
}
</style>
