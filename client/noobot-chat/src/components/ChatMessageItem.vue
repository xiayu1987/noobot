<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import { Document, WarningFilled, Download, View } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import ThinkingPanel from "./ThinkingPanel.vue";
import { downloadWorkspaceFileApi, getWorkspaceFileApi } from "../api/chatApi";

const props = defineProps({
  messageItem: { type: Object, required: true },
  allMessages: { type: Array, default: () => [] },
  sessionDocs: { type: Array, default: () => [] },
  userId: { type: String, default: "" },
  authFetch: { type: Function, default: null },
  renderMarkdown: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  isImageMime: { type: Function, required: true },
});

function getSubTaskStatusText() {
  const messageItem = props.messageItem || {};
  if (messageItem.pending) return "子任务处理中...";
  if (messageItem.statusLabel === "已停止") return "子任务已停止";
  if (messageItem.statusLabel === "生成失败") return "子任务处理失败";
  return "子任务处理完成";
}

function hasSubTaskActivity(messageItem = {}) {
  const realtimeLogs = Array.isArray(messageItem?.realtimeLogs)
    ? messageItem.realtimeLogs
    : [];
  const completedToolLogs = Array.isArray(messageItem?.completedToolLogs)
    ? messageItem.completedToolLogs
    : [];
  return (
    realtimeLogs.some((logItem) => Boolean(logItem?.subAgentCall)) ||
    completedToolLogs.some((logItem) => Number(logItem?.depth || 0) > 1)
  );
}

function tryParseJsonContent(content = "") {
  try {
    return JSON.parse(String(content || ""));
  } catch {
    return null;
  }
}

function parseToolFileResult(content = "") {
  const parsed = tryParseJsonContent(content);
  if (!parsed) return null;
  const toolName = String(parsed?.toolName || "").trim();
  if (!["write_file", "write_task_deliverable_file"].includes(toolName)) return null;
  if (parsed?.ok === false) return null;

  if (toolName === "write_file" && String(parsed?.state || "").toUpperCase() !== "OK") {
    return null;
  }

  const resolvedPath = String(
    parsed?.resolvedPath || parsed?.path || "",
  ).trim();
  const fileName = String(parsed?.fileName || "").trim();
  if (!resolvedPath || !fileName) return null;
  return { toolName, resolvedPath, fileName };
}

async function onDownloadFile(fileItem = {}) {
  const userId = String(props.userId || "").trim();
  const relativePath = String(fileItem?.relativePath || "").trim();
  if (!userId || !relativePath) return;
  try {
    const res = await downloadWorkspaceFileApi(
      { userId, path: relativePath },
      { fetcher: props.authFetch || undefined },
    );
    if (!res.ok) {
      let errorText = `下载失败: HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) errorText = String(data.error);
      } catch {
        // ignore parse error
      }
      throw new Error(errorText);
    }
    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = String(fileItem?.fileName || "download");
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    ElMessage.error(error?.message || "下载失败");
  }
}

function getFileExtension(fileName = "") {
  const normalized = String(fileName || "").trim().toLowerCase();
  const idx = normalized.lastIndexOf(".");
  if (idx < 0) return "";
  return normalized.slice(idx + 1);
}

function isMarkdownFile(fileName = "") {
  return new Set(["md", "markdown", "mdx"]).has(getFileExtension(fileName));
}

function isImageFile(fileName = "") {
  return new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "svg",
    "ico",
    "avif",
  ]).has(getFileExtension(fileName));
}

const previewVisible = ref(false);
const previewLoading = ref(false);
const previewError = ref("");
const previewFileName = ref("");
const previewMode = ref("text");
const previewTextContent = ref("");
const previewImageUrl = ref("");

function cleanupPreviewImageUrl() {
  if (!previewImageUrl.value) return;
  URL.revokeObjectURL(previewImageUrl.value);
  previewImageUrl.value = "";
}

async function openFilePreview(fileItem = {}) {
  const userId = String(props.userId || "").trim();
  const relativePath = String(fileItem?.relativePath || "").trim();
  const fileName = String(fileItem?.fileName || "").trim();
  if (!userId || !relativePath || !fileName) return;

  previewVisible.value = true;
  previewLoading.value = true;
  previewError.value = "";
  previewFileName.value = fileName;
  previewMode.value = "text";
  previewTextContent.value = "";
  cleanupPreviewImageUrl();

  try {
    if (isImageFile(fileName)) {
      const downloadRes = await downloadWorkspaceFileApi(
        { userId, path: relativePath },
        { fetcher: props.authFetch || undefined },
      );
      if (!downloadRes.ok) {
        let errorText = `预览失败: HTTP ${downloadRes.status}`;
        try {
          const data = await downloadRes.json();
          if (data?.error) errorText = String(data.error);
        } catch {
          // ignore
        }
        throw new Error(errorText);
      }
      const blob = await downloadRes.blob();
      previewImageUrl.value = URL.createObjectURL(blob);
      previewMode.value = "image";
      return;
    }

    const res = await getWorkspaceFileApi(
      { userId, path: relativePath },
      { fetcher: props.authFetch || undefined },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data?.error || "预览失败");
    }
    if (data.isText === false) {
      throw new Error("当前文件类型暂不支持预览");
    }
    previewTextContent.value = String(data.content || "");
    previewMode.value = isMarkdownFile(fileName) ? "markdown" : "text";
  } catch (error) {
    previewError.value = error?.message || "预览失败";
  } finally {
    previewLoading.value = false;
  }
}

function closePreviewDialog() {
  previewVisible.value = false;
  previewLoading.value = false;
  previewError.value = "";
  previewFileName.value = "";
  previewMode.value = "text";
  previewTextContent.value = "";
  cleanupPreviewImageUrl();
}

onBeforeUnmount(() => {
  cleanupPreviewImageUrl();
});

function resolveRelativeWorkspacePath(absolutePath = "") {
  const normalizedUserId = String(props.userId || "").trim();
  const normalizedPath = String(absolutePath || "").trim();
  if (!normalizedUserId || !normalizedPath) return "";
  const marker = `/workspace/${normalizedUserId}/`;
  const idx = normalizedPath.indexOf(marker);
  if (idx < 0) return "";
  return normalizedPath.slice(idx + marker.length);
}

const writtenFiles = computed(() => {
  const dialogProcessId = String(props.messageItem?.dialogProcessId || "").trim();
  if (!dialogProcessId) return [];
  const out = [];
  const seen = new Set();
  const relatedDialogIds = new Set([dialogProcessId]);
  const candidateMessages = [
    ...(Array.isArray(props.allMessages) ? props.allMessages : []),
    ...((Array.isArray(props.sessionDocs) ? props.sessionDocs : []).flatMap((sessionDoc) =>
      Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [],
    )),
  ];

  const addCandidate = (sessionMessage = {}) => {
    const parsed = parseToolFileResult(sessionMessage?.content || "");
    if (!parsed) return;
    const { resolvedPath, fileName, toolName } = parsed;
    if (seen.has(resolvedPath)) return;
    seen.add(resolvedPath);
    const relativePath = resolveRelativeWorkspacePath(resolvedPath);
    out.push({
      toolName,
      resolvedPath,
      fileName,
      relativePath,
    });
  };

  // 递归收集后代：子 session、子 session 的子 session ...（按 parentDialogProcessId 链路）
  let changed = true;
  while (changed) {
    changed = false;
    for (const sessionMessage of candidateMessages) {
      const parentId = String(sessionMessage?.parentDialogProcessId || "").trim();
      const childDialogId = String(sessionMessage?.dialogProcessId || "").trim();
      if (!parentId || !childDialogId) continue;
      if (!relatedDialogIds.has(parentId)) continue;
      if (relatedDialogIds.has(childDialogId)) continue;
      relatedDialogIds.add(childDialogId);
      changed = true;
    }
  }

  // 收集当前轮次 + 全部后代链路上的工具产物文件
  for (const sessionMessage of candidateMessages) {
    if (String(sessionMessage?.role || "") !== "tool") continue;
    const currentDialogId = String(sessionMessage?.dialogProcessId || "").trim();
    const parentId = String(sessionMessage?.parentDialogProcessId || "").trim();
    if (!relatedDialogIds.has(currentDialogId) && !relatedDialogIds.has(parentId))
      continue;
    addCandidate(sessionMessage);
  }
  return out;
});
</script>

<template>
  <div class="msg-wrapper" :class="messageItem.role">
    <div class="avatar">
      {{ messageItem.role === "user" ? "我" : "AI" }}
    </div>

    <div class="msg-content">
      <div class="meta">
        <span class="time">{{ formatTime(messageItem.ts) }}</span>
      </div>

      <div class="bubble">
        <div class="msg-type-row" v-if="messageItem.type && messageItem.type !== 'tool_call'">
          <el-tag size="small" effect="dark" class="type-tag">{{
            messageItem.type
          }}</el-tag>
        </div>
        <div
          v-if="messageItem.role === 'assistant' && (messageItem.pending || messageItem.statusLabel)"
          class="message-status-row"
        >
          <div class="message-pending" :class="{ done: !messageItem.pending }">
            <span class="pending-dot"></span>
            {{ messageItem.pending ? "生成中..." : messageItem.statusLabel }}
          </div>
          <div
            v-if="hasSubTaskActivity(messageItem)"
            class="message-pending"
            :class="{ done: !messageItem.pending }"
          >
            <span class="pending-dot"></span>
            {{ getSubTaskStatusText() }}
          </div>
        </div>

        <div v-if="messageItem.attachments?.length" class="msg-attachments">
          <div
            v-for="(attachmentItem, attachmentIndex) in messageItem.attachments"
            :key="attachmentIndex"
            class="file-card"
          >
            <img
              v-if="isImageMime(attachmentItem.mimeType || '') && attachmentItem.previewUrl"
              :src="attachmentItem.previewUrl"
              :alt="attachmentItem.name"
              class="file-thumb"
            />
            <div v-else class="file-icon">
              <el-icon><Document /></el-icon>
            </div>
            <div class="file-meta">
              <div class="file-name">{{ attachmentItem.name }}</div>
              <div class="file-size">
                {{ formatFileSize(attachmentItem.size || 0) }}
              </div>
            </div>
          </div>
        </div>

        <ThinkingPanel :message-item="messageItem" :all-messages="allMessages" />

        <div v-if="messageItem.error" class="error-alert">
          <el-icon class="error-icon"><WarningFilled /></el-icon>
          {{ messageItem.error }}
        </div>

        <div class="md" v-html="renderMarkdown(messageItem.content)" />

        <!-- 醒目的生成文件展示区 -->
        <div
          v-if="messageItem.role === 'assistant' && writtenFiles.length"
          class="written-files-container"
        >
          <div class="written-files-header">
            <el-icon><Document /></el-icon>
            <span>生成文件 ({{ writtenFiles.length }})</span>
          </div>
          <div class="written-files-list">
            <template v-for="(fileItem, fileIndex) in writtenFiles" :key="`${fileItem.resolvedPath}-${fileIndex}`">
              <button
                v-if="fileItem.relativePath"
                type="button"
                class="written-file-link"
                :title="fileItem.resolvedPath"
                @click="openFilePreview(fileItem)"
              >
                <el-icon><View /></el-icon>
                <span class="file-name-text">{{ fileItem.fileName }}</span>
              </button>
              <span v-else class="written-file-link disabled" :title="fileItem.resolvedPath">
                <el-icon><Document /></el-icon>
                <span class="file-name-text">{{ fileItem.fileName }}</span>
              </span>
              <button
                v-if="fileItem.relativePath"
                type="button"
                class="written-file-download-btn"
                :title="`下载 ${fileItem.fileName}`"
                @click="onDownloadFile(fileItem)"
              >
                <el-icon><Download /></el-icon>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>

  <el-dialog
    v-model="previewVisible"
    :title="`文件预览：${previewFileName || ''}`"
    width="72%"
    top="6vh"
    class="generated-file-preview-dialog"
    @closed="closePreviewDialog"
  >
    <div class="preview-body" v-loading="previewLoading">
      <div v-if="previewError" class="preview-error">{{ previewError }}</div>
      <img
        v-else-if="previewMode === 'image' && previewImageUrl"
        :src="previewImageUrl"
        :alt="previewFileName"
        class="preview-image"
      />
      <div
        v-else-if="previewMode === 'markdown'"
        class="preview-markdown"
        v-html="renderMarkdown(previewTextContent)"
      />
      <pre v-else class="preview-text">{{ previewTextContent }}</pre>
    </div>
  </el-dialog>
</template>

<style scoped>
.msg-wrapper {
  display: flex;
  gap: 16px;
  max-width: 100%;
}

.msg-wrapper.user {
  flex-direction: row-reverse;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  color: #fff;
}

.msg-wrapper.assistant .avatar {
  background: var(--noobot-msg-assistant-avatar);
}

.msg-wrapper.user .avatar {
  background: var(--noobot-msg-user-avatar);
}

.msg-content {
  display: flex;
  flex-direction: column;
  max-width: calc(100% - 52px);
}

.msg-wrapper.assistant .msg-content {
  width: 760px;
  max-width: calc(100% - 52px);
}

.msg-wrapper.user .msg-content {
  align-items: flex-end;
}

.meta {
  font-size: 12px;
  color: var(--noobot-msg-meta);
  margin-bottom: 6px;
  padding: 0 4px;
}

.bubble {
  padding: 14px 18px;
  border-radius: 16px;
  font-size: 15px;
  line-height: 1.6;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.2);
  word-wrap: break-word;
}

.msg-wrapper.assistant .bubble {
  background: var(--noobot-msg-assistant-bg);
  border: 1px solid var(--noobot-msg-assistant-border);
  border-top-left-radius: 4px;
  color: var(--noobot-msg-assistant-text);
}

.msg-wrapper.user .bubble {
  background: var(--noobot-msg-user-bg);
  border: 1px solid var(--noobot-msg-user-border);
  border-top-right-radius: 4px;
  color: var(--noobot-msg-user-text);
}

.msg-type-row {
  margin-bottom: 8px;
}

.type-tag {
  border: none;
  background: var(--noobot-msg-tag-bg);
  color: var(--noobot-msg-tag-text);
}

.message-pending {
  font-size: 12px;
  color: var(--noobot-msg-pending-text);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.message-status-row {
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.pending-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--noobot-msg-pending-dot);
  animation: pendingPulse 0.9s ease-in-out infinite;
}

.message-pending.done .pending-dot {
  background: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.2), 0 0 10px rgba(52, 211, 153, 0.9);
  animation: none;
  opacity: 1;
  transform: scale(1);
}

.message-pending.done {
  color: #86efac;
  font-weight: 600;
}

@keyframes pendingPulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.error-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--noobot-msg-error-bg);
  border: 1px solid var(--noobot-msg-error-border);
  color: var(--noobot-msg-error-text);
  font-size: 13px;
}

.error-icon {
  font-size: 14px;
}

.msg-attachments {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--noobot-msg-file-card-bg);
  border: 1px solid var(--noobot-msg-file-card-border);
  border-radius: 10px;
  padding: 8px 10px;
}

.file-thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
}

.file-icon {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--noobot-msg-file-icon-bg);
}

.file-meta {
  min-width: 0;
}

.file-name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--noobot-msg-file-name);
}

.file-size {
  font-size: 12px;
  color: var(--noobot-msg-file-size);
}

.md {
  width: 100%;
  overflow-x: auto;
}

/* --- 醒目的生成文件展示区样式 --- */
.written-files-container {
  margin-top: 16px;
  padding: 14px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px dashed rgba(59, 130, 246, 0.3);
  border-radius: 10px;
}

.written-files-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #60a5fa;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
}

.written-files-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.written-file-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #1e3a8a;
  border: 1px solid #3b82f6;
  color: #bfdbfe;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
  outline: none;
  max-width: 100%;
}

.file-name-text {
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.written-file-link:hover:not(.disabled) {
  background: #2563eb;
  color: #ffffff;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
  border-color: #60a5fa;
}

.written-file-link.disabled {
  cursor: default;
  background: #1e293b;
  border-color: #334155;
  color: #94a3b8;
  box-shadow: none;
}

.written-file-download-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #3b82f6;
  background: #0f2742;
  color: #bfdbfe;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.written-file-download-btn:hover {
  background: #1d4ed8;
  color: #fff;
}

.preview-body {
  min-height: 240px;
  max-height: 68vh;
  overflow: auto;
  background: #0b1220;
  border: 1px solid #1f2d4a;
  border-radius: 10px;
  padding: 14px;
}

.preview-error {
  color: #fca5a5;
}

.preview-image {
  max-width: 100%;
  max-height: 62vh;
  margin: 0 auto;
  display: block;
  border-radius: 8px;
}

.preview-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #dbeafe;
  font-size: 13px;
  line-height: 1.6;
}

.preview-markdown {
  color: #dbeafe;
  font-size: 13px;
}

/* --- Markdown 内部样式 --- */
.md :deep(p) {
  margin: 0 0 12px 0;
}

.md :deep(p:last-child) {
  margin-bottom: 0;
}

.md :deep(a) {
  color: var(--noobot-msg-link);
  text-decoration: none;
}

.md :deep(a:hover) {
  text-decoration: underline;
}

.md :deep(code) {
  background: var(--noobot-msg-inline-code-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  color: var(--noobot-msg-inline-code-text);
}

.md :deep(pre) {
  background: var(--noobot-msg-code-block-bg);
  color: var(--noobot-msg-code-block-text);
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 12px 0;
}

.md :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 0.9em;
}
</style>
