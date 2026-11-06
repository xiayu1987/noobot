<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, watch, nextTick, ref, onBeforeUnmount } from "vue";
import { CopyDocument, Memo } from "@element-plus/icons-vue";
import { FILE_PREVIEW_TABS } from "@noobot/attachment-protocol/preview";
import { renderMermaidInElement } from "../utils/mermaid-renderer.js";
import { renderFileMarkdown } from "../utils/markdown-renderer.js";
import {
  createHtmlPreviewDocument,
  resolveHtmlPreviewResources,
  resolveMarkdownPreviewResources,
  formatFileText,
  parseDelimitedText,
} from "../utils/file-preview-format.js";
import { useLocale } from "../i18n/useLocale.js";

const props = defineProps({
  active: { type: Boolean, default: true },
  descriptor: { type: Object, required: true },
  url: { type: String, default: "" },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  textContent: { type: String, default: "" },
  renderMarkdown: { type: Function, default: renderFileMarkdown },
  resolveResource: { type: Function, default: undefined },
});
const emit = defineEmits(["copy-markdown-rich", "copy-markdown-text"]);
const mode = computed(() => props.descriptor.type);
const name = computed(() => props.descriptor.name);
const { translate } = useLocale();
const markdownContainerRef = ref(null);
const mediaElement = ref(null);
let playback;
watch(
  () => [props.descriptor, props.url],
  ([descriptor], [previousDescriptor, previousUrl]) => {
    const media = mediaElement.value;
    playback =
      descriptor === previousDescriptor && previousUrl && media
        ? { time: media.currentTime, playing: !media.paused }
        : null;
  },
  { flush: "pre" },
);
async function restorePlayback() {
  if (!playback) return;
  const saved = playback;
  playback = null;
  try {
    mediaElement.value.currentTime = saved.time;
    if (saved.playing) await mediaElement.value.play();
  } catch (error) {
    renderError.value = error.message;
  }
}
const tab = ref("preview");
const renderError = ref("");
const rendering = ref(false);
const htmlDocument = ref("");
const markdownHtml = ref("");
const formattedText = ref("");
const rows = ref([]);
const hasTabs = computed(() => FILE_PREVIEW_TABS.has(mode.value));
const showSource = computed(() => tab.value === "source" || !hasTabs.value);
const displayError = computed(() => {
  const error = props.error ? props.error : renderError.value;
  if (error === "FILE_PREVIEW_TOO_LARGE") return translate("message.previewFileTooLarge");
  if (error.startsWith("FILE_PREVIEW_"))
    return translate("message.previewResourceFailed", { error });
  return error;
});
const showCopyActions = computed(() => mode.value === "markdown" && !props.loading && !props.error);
watch(
  () => props.descriptor,
  () => {
    tab.value = "preview";
  },
);
let renderController;
let rendered = false;
let previousInputs;
onBeforeUnmount(() => renderController?.abort());
watch(
  () => [
    props.active,
    props.loading,
    props.error,
    props.textContent,
    props.descriptor,
    props.url,
    props.resolveResource,
    tab.value,
  ],
  async (values) => {
    const inputs = values.slice(0, -1);
    const changed =
      !previousInputs || inputs.some((value, index) => value !== previousInputs[index]);
    previousInputs = inputs;
    if (changed) {
      renderController?.abort();
      rendered = false;
      rendering.value = false;
      renderError.value = "";
      htmlDocument.value = "";
      markdownHtml.value = "";
      rows.value = [];
      formattedText.value = "";
    }
    if (!props.active || props.loading || props.error || tab.value !== "preview") return;
    if (rendered || rendering.value) {
      await nextTick();
      if (mode.value === "markdown") await renderMermaidInElement(markdownContainerRef.value);
      return;
    }
    const controller = new AbortController();
    renderController = controller;
    rendering.value = true;
    try {
      await renderPreview(controller.signal);
      if (!controller.signal.aborted) rendered = true;
    } catch (error) {
      if (!controller.signal.aborted) renderError.value = error.message;
    } finally {
      if (!controller.signal.aborted) rendering.value = false;
    }
  },
  { immediate: true },
);
async function renderPreview(signal) {
  if (mode.value === "html") {
    const doc = createHtmlPreviewDocument(props.textContent);
    const html = await resolveHtmlPreviewResources(doc, props.resolveResource, signal);
    if (!signal.aborted) htmlDocument.value = html;
    return;
  }
  if (["csv", "tsv"].includes(mode.value)) {
    rows.value = parseDelimitedText(props.textContent, mode.value === "csv" ? "," : "\t");
    return;
  }
  if (["json", "xml", "code"].includes(mode.value)) {
    const text = formatFileText(mode.value, props.textContent);
    const { language } = props.descriptor;
    const { default: highlighter } = await import("highlight.js/lib/common");
    if (!signal.aborted) formattedText.value = highlighter.highlight(text, { language }).value;
    return;
  }
  if (mode.value === "markdown") {
    const html = await resolveMarkdownPreviewResources(
      props.renderMarkdown(props.textContent),
      props.resolveResource,
      signal,
    );
    if (signal.aborted) return;
    markdownHtml.value = html;
    await nextTick();
    if (!signal.aborted) await renderMermaidInElement(markdownContainerRef.value);
  }
}
function showSourceTab() {
  tab.value = "source";
}
defineExpose({ showSourceTab });
</script>

<template>
  <div
    class="preview-body noobot-preview-surface"
    v-loading="loading || rendering"
    :aria-busy="loading || rendering"
  >
    <div v-if="hasTabs" class="preview-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'preview'"
        :class="{ 'is-active': tab === 'preview' }"
        @click="tab = 'preview'"
      >
        {{ translate("message.filePreviewTab") }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'source'"
        :class="{ 'is-active': tab === 'source' }"
        @click="tab = 'source'"
      >
        {{ translate("message.fileSourceTab") }}
      </button>
    </div>
    <div v-if="showCopyActions" class="preview-copy-actions noobot-copy-actions">
      <el-tooltip :content="translate('message.copyFormat')" placement="top" :show-after="300">
        <el-button
          size="small"
          class="noobot-icon-button noobot-flat-inline-icon-btn noobot-copy-button"
          :aria-label="translate('message.copyFormat')"
          @click="emit('copy-markdown-rich')"
          ><el-icon><CopyDocument /></el-icon
        ></el-button>
      </el-tooltip>
      <el-tooltip :content="translate('message.copyText')" placement="top" :show-after="300">
        <el-button
          size="small"
          class="noobot-icon-button noobot-flat-inline-icon-btn noobot-copy-button"
          :aria-label="translate('message.copyText')"
          @click="emit('copy-markdown-text')"
          ><el-icon><Memo /></el-icon
        ></el-button>
      </el-tooltip>
    </div>
    <div
      class="preview-page"
      :class="{ 'is-embedded': (!showSource && mode === 'html') || mode === 'pdf' }"
      :role="hasTabs ? 'tabpanel' : undefined"
    >
      <div
        v-if="displayError && (error || !hasTabs || !showSource)"
        class="preview-error noobot-error-surface is-preview"
      >
        {{ displayError }}
      </div>
      <template v-else-if="!loading">
        <img
          v-if="mode === 'image' && url"
          :src="url"
          :alt="name"
          class="preview-image"
          referrerpolicy="no-referrer"
          @error="renderError = translate('message.previewFailed')"
        />
        <video
          v-else-if="mode === 'video' && url"
          ref="mediaElement"
          @loadedmetadata="restorePlayback"
          class="preview-video"
          :src="url"
          controls
          preload="metadata"
          @error="renderError = translate('message.previewFailed')"
        />
        <audio
          v-else-if="mode === 'audio' && url"
          ref="mediaElement"
          @loadedmetadata="restorePlayback"
          class="preview-audio"
          :src="url"
          controls
          preload="metadata"
          @error="renderError = translate('message.previewFailed')"
        />
        <iframe v-else-if="mode === 'pdf' && url" class="preview-frame" :src="url" :title="name" />
        <div v-else-if="['unsupported', 'office'].includes(mode)" class="preview-error">
          {{ translate("settings.binaryNoPreview") }}
        </div>
        <slot v-else-if="showSource" name="source">
          <pre class="preview-text">{{ textContent }}</pre>
        </slot>
        <div
          v-else-if="mode === 'markdown'"
          ref="markdownContainerRef"
          class="preview-markdown noobot-rich-content"
          v-html="markdownHtml"
        />
        <template v-else-if="mode === 'html'">
          <iframe
            v-if="htmlDocument"
            class="preview-frame"
            sandbox=""
            referrerpolicy="no-referrer"
            :srcdoc="htmlDocument"
            :title="name"
          />
        </template>
        <div v-else-if="mode === 'csv' || mode === 'tsv'" class="preview-table-wrap">
          <table class="preview-table">
            <tbody>
              <tr v-for="(row, index) in rows" :key="index">
                <td v-for="(cell, column) in row" :key="column">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <pre v-else class="preview-text preview-formatted"><code v-html="formattedText" /></pre>
      </template>
    </div>
  </div>
</template>

<style scoped>
.preview-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  flex: 1;
}
.preview-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.preview-page.is-embedded {
  display: flex;
  overflow: hidden;
}
.preview-error {
  padding: var(--noobot-space-md);
}
.preview-tabs {
  display: flex;
  flex-shrink: 0;
  gap: var(--noobot-space-md);
  margin-bottom: var(--noobot-space-md);
  border-bottom: 1px solid var(--noobot-divider);
}
.preview-tabs button {
  background: transparent;
  color: var(--noobot-preview-text);
  border: 0;
  padding: var(--noobot-space-sm);
  cursor: pointer;
}
.preview-tabs .is-active {
  border-bottom: 2px solid currentColor;
}
.preview-copy-actions {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  margin-bottom: var(--noobot-space-md);
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
.preview-frame {
  display: block;
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  background: white;
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
.preview-formatted {
  white-space: pre;
}
.preview-markdown {
  color: var(--noobot-preview-text);
}
.preview-table {
  border-collapse: collapse;
}
.preview-table td {
  border: 1px solid var(--noobot-divider);
  padding: var(--noobot-space-sm);
  white-space: pre-wrap;
}
</style>
