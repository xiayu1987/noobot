<script setup>
import { computed, watch, nextTick, ref } from "vue";
import { renderMermaidInElement } from "../../shared/utils/mermaid-renderer";
import { useLocale } from "../../shared/i18n/useLocale";

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
  () =>
    resolvedPreviewMode.value === "markdown" &&
    !resolvedLoading.value &&
    !resolvedError.value,
);

function emitCopyMarkdownRich() {
  if (!markdownContainerRef.value) return;
  emit("copy-markdown-rich", String(markdownContainerRef.value.innerHTML || ""));
}

watch(
  () => [
    props.active,
    resolvedPreviewText.value,
    resolvedPreviewMode.value,
  ],
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
  <div class="preview-body" v-loading="resolvedLoading">
    <div v-if="showCopyActions" class="preview-copy-actions">
      <el-button size="small" type="primary" plain @click="emitCopyMarkdownRich">{{ translate("message.copyFormat") }}</el-button>
      <el-button size="small" @click="emit('copy-markdown-text')">{{ translate("message.copyText") }}</el-button>
    </div>
    <div v-if="resolvedError" class="preview-error">{{ resolvedError }}</div>
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
    <div
      v-else-if="resolvedPreviewMode === 'markdown'"
      ref="markdownContainerRef"
      class="preview-markdown"
      v-html="renderMarkdown(resolvedPreviewText)"
    />
    <pre v-else class="preview-text">{{ resolvedPreviewText }}</pre>
  </div>
</template>

<style scoped>
/* ==================== 基础容器样式 ==================== */
.preview-body {
  min-height: 240px;
  max-height: 68vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--noobot-preview-bg);
  border: 1px solid var(--noobot-preview-border);
  border-radius: var(--noobot-radius-sm);
  padding: 20px 24px;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--noobot-panel-border) 35%, transparent);
  transition: all 0.3s ease;
}

/* 自定义滚动条 */
.preview-body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.preview-body::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--noobot-panel-border) 90%, var(--noobot-text-muted));
  border-radius: 4px;
}
.preview-body::-webkit-scrollbar-thumb:hover {
  background: var(--noobot-text-secondary);
}
.preview-body::-webkit-scrollbar-track {
  background: transparent;
}

.preview-error {
  color: var(--noobot-preview-danger-text);
  background: var(--noobot-preview-danger-bg);
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--noobot-preview-danger-border);
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
  border-radius: 6px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--noobot-mask-bg) 55%, transparent);
}

.preview-video {
  width: 100%;
  max-height: 60vh;
  display: block;
  border-radius: 6px;
  background: var(--noobot-msg-code-block-bg);
}

.preview-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--noobot-preview-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  line-height: 1.6;
}

/* ==================== Markdown 核心排版样式 ==================== */
.preview-markdown {
  color: var(--noobot-preview-text);
  font-size: 15px;
  line-height: 1.7;
  word-wrap: break-word;
}

/* 段落与基础元素 */
.preview-markdown :deep(p) { margin-top: 0; margin-bottom: 16px; }
.preview-markdown :deep(a) { color: var(--noobot-text-accent); text-decoration: none; }
.preview-markdown :deep(a:hover) { text-decoration: underline; }
.preview-markdown :deep(hr) { height: 1px; padding: 0; margin: 24px 0; background-color: var(--noobot-divider); border: 0; }

/* 标题 */
.preview-markdown :deep(h1), .preview-markdown :deep(h2), .preview-markdown :deep(h3),
.preview-markdown :deep(h4), .preview-markdown :deep(h5), .preview-markdown :deep(h6) {
  margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; color: var(--noobot-text-strong);
}
.preview-markdown :deep(h1) { font-size: 1.8em; padding-bottom: 0.3em; border-bottom: 1px solid var(--noobot-divider); }
.preview-markdown :deep(h2) { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--noobot-divider); }
.preview-markdown :deep(h3) { font-size: 1.25em; }
.preview-markdown :deep(h4) { font-size: 1em; }

/* 引用块 */
.preview-markdown :deep(blockquote) {
  margin: 16px 0; padding: 12px 16px; color: var(--noobot-text-secondary); background-color: var(--noobot-panel-muted);
  border-left: 4px solid var(--noobot-panel-border); border-radius: 0 6px 6px 0; font-style: italic;
}
.preview-markdown :deep(blockquote p:last-child) { margin-bottom: 0; }

/* 列表 */
.preview-markdown :deep(ul), .preview-markdown :deep(ol) { margin-top: 0; margin-bottom: 16px; padding-left: 2em; }
.preview-markdown :deep(li) { margin: 4px 0; }
.preview-markdown :deep(li > p) { margin-top: 16px; }
.preview-markdown :deep(ul li::marker) { color: var(--noobot-text-muted); }
.preview-markdown :deep(ol li::marker) { color: var(--noobot-text-secondary); font-weight: 500; }

/* 行内代码 */
.preview-markdown :deep(code) {
  background-color: var(--noobot-msg-inline-code-bg); color: var(--noobot-msg-inline-code-text); padding: 0.2em 0.4em; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9em;
}

/* 多行代码块 */
.preview-markdown :deep(pre) {
  background-color: var(--noobot-msg-code-block-bg); color: var(--noobot-msg-code-block-text); border-radius: 8px; padding: 16px;
  overflow-x: auto; margin-bottom: 16px;
}
.preview-markdown :deep(pre code) { background-color: transparent; color: inherit; padding: 0; font-size: 13.5px; border-radius: 0; }

/* 表格 */
.preview-markdown :deep(table) { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px; }
.preview-markdown :deep(th), .preview-markdown :deep(td) { border: 1px solid var(--noobot-panel-border); padding: 10px 14px; text-align: left; }
.preview-markdown :deep(th) { background-color: var(--noobot-panel-muted); font-weight: 600; color: var(--noobot-text-main); }
.preview-markdown :deep(tr:nth-child(even)) { background-color: color-mix(in srgb, var(--noobot-panel-muted) 72%, transparent); }
.preview-markdown :deep(tr:hover) { background-color: var(--noobot-accent-soft); }

/* Mermaid 图表 */
.preview-markdown :deep(.mermaid) {
  margin: 20px 0; padding: 16px; border: 1px solid var(--noobot-preview-border); border-radius: 8px;
  background: var(--noobot-preview-bg); overflow-x: auto; display: flex; justify-content: center;
  box-shadow: 0 1px 4px color-mix(in srgb, var(--noobot-panel-border) 45%, transparent);
}
.preview-markdown :deep(.mermaid svg) { max-width: 100% !important; height: auto !important; display: block; }
.preview-markdown :deep(.mermaid-render-error) {
  color: var(--noobot-preview-danger-text); background: var(--noobot-preview-danger-bg); border: 1px solid var(--noobot-preview-danger-border); border-radius: 8px;
  padding: 12px; white-space: pre-wrap; font-family: monospace;
}
</style>
