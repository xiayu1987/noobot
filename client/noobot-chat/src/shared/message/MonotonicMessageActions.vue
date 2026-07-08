<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

const props = defineProps({
  visible: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  messageItem: { type: Object, default: () => ({}) },
  translate: { type: Function, default: (key = "") => key },
  onDelete: { type: Function, default: null },
  onResend: { type: Function, default: null },
});

const operating = ref(false);
const editing = ref(false);
const draftContent = ref("");
const textareaRef = ref(null);
const fileInputRef = ref(null);
const editAttachments = ref([]);
const attachmentStats = computed(() => {
  const items = Array.isArray(editAttachments.value) ? editAttachments.value : [];
  return {
    total: items.length,
    history: items.filter((item) => item?.kind === "history").length,
    added: items.filter((item) => item?.kind === "new").length,
  };
});

const LOCAL_TRANSLATIONS = {
  "common.cancel": "取消",
  "common.confirm": "确认",
  "message.contentRequired": "请输入消息内容",
  "message.monotonicActionFailed": "操作失败，请稍后重试",
  "message.monotonicDeleteConfirm": "确认删除本轮消息及其后续回复吗？",
  "message.monotonicDeleteTitle": "删除消息",
  "message.monotonicEdit": "编辑重发",
  "message.monotonicDelete": "删除",
  "message.monotonicEditPlaceholder": "编辑消息内容后重发",
  "message.monotonicEditTip": "Ctrl/⌘ + Enter 发送，Esc 取消",
  "message.monotonicSendEdited": "发送",
};

function t(key) {
  const fallbackTranslated = LOCAL_TRANSLATIONS[key] || key;
  const translated = props.translate(key, fallbackTranslated);
  return translated && translated !== key ? translated : fallbackTranslated;
}

function isImageMime(mimeType = "") {
  return String(mimeType || "").toLowerCase().startsWith("image/");
}

function attachmentName(item = {}) {
  return String(item?.name || item?.filename || item?.fileName || item?.path || item?.relativePath || "附件").trim();
}

function attachmentMime(item = {}) {
  return String(item?.mimeType || item?.type || item?.mime || "application/octet-stream").trim();
}

function formatAttachmentSize(size = 0) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return "未知大小";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentTypeLabel(attachment = {}) {
  const mime = attachmentMime(attachment).toLowerCase();
  if (mime.startsWith("image/")) return "图片";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("zip") || mime.includes("compressed")) return "压缩包";
  if (mime.includes("text") || mime.includes("json") || mime.includes("markdown")) return "文本";
  return "文件";
}

function attachmentIcon(attachment = {}) {
  const mime = attachmentMime(attachment).toLowerCase();
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("zip") || mime.includes("compressed")) return "ZIP";
  if (mime.includes("json")) return "{}";
  if (mime.includes("text") || mime.includes("markdown")) return "TXT";
  return "FILE";
}

function attachmentKey(item = {}) {
  return String(item?.attachmentId || item?.id || "").trim() || [
    String(item?.path || "").trim(),
    String(item?.relativePath || "").trim(),
    attachmentName(item),
    String(item?.size || 0),
    attachmentMime(item),
  ].join("|");
}

function cloneHistoryAttachment(item = {}) {
  const cloned = { ...item };
  delete cloned.previewUrl;
  delete cloned.raw;
  delete cloned.file;
  return cloned;
}

function revokeEditAttachmentUrls(items = editAttachments.value) {
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.kind === "new" && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}

function resetEditAttachments(nextItems = []) {
  revokeEditAttachmentUrls();
  editAttachments.value = nextItems;
}

function initEditAttachments() {
  const source = Array.isArray(props.messageItem?.attachments) ? props.messageItem.attachments : [];
  const seen = new Set();
  const next = [];
  for (const attachment of source) {
    if (!attachment || typeof attachment !== "object") continue;
    const meta = cloneHistoryAttachment(attachment);
    const key = attachmentKey(meta);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    next.push({
      kind: "history",
      key: key || `history:${next.length}`,
      name: attachmentName(meta),
      mimeType: attachmentMime(meta),
      size: Number(meta?.size || 0) || 0,
      meta,
      previewUrl: isImageMime(attachmentMime(meta)) ? String(meta?.previewUrl || meta?.url || "") : "",
    });
  }
  resetEditAttachments(next);
}

function rawFileKey(file = {}) {
  return [
    String(file?.name || "").trim(),
    String(file?.size || 0),
    String(file?.lastModified || 0),
    String(file?.type || "").trim(),
  ].join("|");
}

function handleChooseFiles() {
  if (props.disabled || operating.value) return;
  fileInputRef.value?.click?.();
}

function handleAttachmentInput(event) {
  const files = Array.from(event?.target?.files || []).filter(Boolean);
  if (event?.target) event.target.value = "";
  if (!files.length) return;
  const seen = new Set(editAttachments.value.map((item) => item.key).filter(Boolean));
  const next = [...editAttachments.value];
  for (const file of files) {
    const key = `new:${rawFileKey(file)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mimeType = file.type || "application/octet-stream";
    next.push({
      kind: "new",
      key,
      name: file.name,
      mimeType,
      size: file.size || 0,
      raw: file,
      previewUrl: isImageMime(mimeType) ? URL.createObjectURL(file) : "",
    });
  }
  editAttachments.value = next;
}

function removeEditAttachment(index) {
  if (operating.value) return;
  const targetIndex = Number(index);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= editAttachments.value.length) return;
  const next = [...editAttachments.value];
  const [removed] = next.splice(targetIndex, 1);
  revokeEditAttachmentUrls([removed]);
  editAttachments.value = next;
}

function buildEditAttachmentPayload() {
  return {
    attachments: editAttachments.value
      .filter((item) => item?.kind === "history")
      .map((item) => cloneHistoryAttachment(item.meta || {})),
    attachmentFiles: editAttachments.value
      .filter((item) => item?.kind === "new" && item.raw)
      .map((item) => ({ raw: item.raw, name: item.name, mimeType: item.mimeType, size: item.size })),
  };
}

onBeforeUnmount(() => revokeEditAttachmentUrls());

function markEditing(value) {
  editing.value = value;
  if (props.messageItem && typeof props.messageItem === "object") {
    props.messageItem.__monotonicEditing = value;
  }
}

async function runAction(action) {
  if (props.disabled || operating.value || typeof action !== "function") return;
  operating.value = true;
  try {
    await action();
  } catch (error) {
    ElMessage.error(error?.message || t("message.monotonicActionFailed"));
  } finally {
    operating.value = false;
  }
}

function handleEdit() {
  if (props.disabled || operating.value || typeof props.onResend !== "function") return;
  draftContent.value = String(props.messageItem?.content || "");
  initEditAttachments();
  markEditing(true);
  nextTick(() => {
    const input = textareaRef.value;
    input?.focus?.();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  });
}

function handleCancelEdit() {
  if (operating.value) return;
  markEditing(false);
  draftContent.value = "";
  resetEditAttachments();
}

async function handleSendEdited() {
  const nextContent = String(draftContent.value || "").trim();
  if (!nextContent) {
    ElMessage.error(t("message.contentRequired"));
    return;
  }
  await runAction(async () => {
    await props.onResend(props.messageItem, nextContent, buildEditAttachmentPayload());
    markEditing(false);
    resetEditAttachments();
  });
}

async function handleDelete() {
  await runAction(async () => {
    await ElMessageBox.confirm(
      t("message.monotonicDeleteConfirm"),
      t("message.monotonicDeleteTitle"),
      {
        type: "warning",
        confirmButtonText: t("common.confirm"),
        cancelButtonText: t("common.cancel"),
      },
    );
    await props.onDelete(props.messageItem);
  });
}
</script>

<template>
  <div v-if="visible" class="monotonic-message-actions" :class="{ editing }">
    <template v-if="editing">
      <div class="monotonic-edit-card noobot-surface-card">
        <div class="monotonic-edit-heading">
          <div class="monotonic-edit-heading-copy">
            <div class="monotonic-edit-title">编辑并重发</div>
            <div class="monotonic-edit-subtitle">调整内容和附件后，将替换本轮消息并重新生成回复</div>
          </div>
          <el-tag type="primary" effect="light" round class="monotonic-mode-tag">
            <svg class="monotonic-mode-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
            重发模式
          </el-tag>
        </div>
        
        <div class="monotonic-edit-body">
          <el-input
            ref="textareaRef"
            v-model="draftContent"
            class="monotonic-edit-textarea"
            type="textarea"
            :disabled="disabled || operating"
            :placeholder="t('message.monotonicEditPlaceholder')"
            :autosize="{ minRows: 4, maxRows: 10 }"
            @keydown.ctrl.enter.prevent="handleSendEdited"
            @keydown.meta.enter.prevent="handleSendEdited"
            @keydown.esc.prevent="handleCancelEdit"
          />
          
          <div class="monotonic-edit-attachments">
            <div class="monotonic-attachment-header">
              <div class="monotonic-attachment-copy">
                <span class="monotonic-attachment-title">附件列表</span>
              </div>
              <div class="monotonic-attachment-stats">
                <el-tag size="small" effect="plain" round class="stat-tag noobot-soft-badge">{{ attachmentStats.total }} 个</el-tag>
                <el-tag v-if="attachmentStats.history" size="small" type="info" effect="light" round class="stat-tag noobot-soft-badge">原 {{ attachmentStats.history }}</el-tag>
                <el-tag v-if="attachmentStats.added" size="small" type="success" effect="light" round class="stat-tag noobot-soft-badge is-success">新 {{ attachmentStats.added }}</el-tag>
              </div>
            </div>

            <el-empty
              v-if="!editAttachments.length"
              class="monotonic-attachment-empty noobot-subtle-row"
              :image-size="48"
              description="暂无附件，可点击下方按钮添加"
            />
            
            <el-scrollbar v-else max-height="200px" class="monotonic-attachment-scroll">
              <div class="monotonic-attachment-list">
                <div
                  v-for="(attachment, index) in editAttachments"
                  :key="attachment.key || index"
                  class="monotonic-attachment-item noobot-subtle-row"
                >
                  <el-image
                    v-if="attachment.previewUrl"
                    class="monotonic-attachment-preview"
                    :src="attachment.previewUrl"
                    fit="cover"
                    :preview-src-list="[attachment.previewUrl]"
                    preview-teleported
                  />
                  <div v-else class="monotonic-attachment-icon">{{ attachmentIcon(attachment) }}</div>
                  
                  <div class="monotonic-attachment-meta">
                    <div class="monotonic-attachment-name" :title="attachment.name">{{ attachment.name }}</div>
                    <div class="monotonic-attachment-desc">
                      <el-tag size="small" :type="attachment.kind === 'new' ? 'success' : 'info'" effect="light" class="kind-tag">
                        {{ attachment.kind === 'new' ? '新增' : '原附件' }}
                      </el-tag>
                      <span class="dot" aria-hidden="true">·</span>
                      <span class="desc-text">{{ attachmentTypeLabel(attachment) }}</span>
                      <span class="dot" aria-hidden="true">·</span>
                      <span class="desc-text">{{ formatAttachmentSize(attachment.size) }}</span>
                    </div>
                  </div>
                  
                  <button
                    class="monotonic-attachment-remove"
                    :disabled="operating"
                    @click="removeEditAttachment(index)"
                    title="移除附件"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>
            </el-scrollbar>
            
            <input
              ref="fileInputRef"
              class="monotonic-file-input"
              type="file"
              multiple
              :disabled="disabled || operating"
              @change="handleAttachmentInput"
            />
            <button
              class="monotonic-add-attachment-btn"
              :disabled="disabled || operating"
              @click="handleChooseFiles"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              添加附件
            </button>
          </div>
        </div>

        <div class="monotonic-edit-footer">
          <span class="monotonic-edit-tip">
            <svg class="monotonic-tip-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            {{ t("message.monotonicEditTip") }}
          </span>
          <div class="monotonic-edit-buttons">
            <el-button
              class="monotonic-footer-btn"
              :disabled="operating"
              @click="handleCancelEdit"
              round
            >
              {{ t("common.cancel") }}
            </el-button>
            <el-button
              class="monotonic-footer-btn"
              type="primary"
              :loading="operating"
              :disabled="disabled || operating || !String(draftContent || '').trim()"
              @click="handleSendEdited"
              round
            >
              <template #icon v-if="!operating">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </template>
              {{ t("message.monotonicSendEdited") }}
            </el-button>
          </div>
        </div>
      </div>
    </template>
    
    <template v-else>
      <div class="monotonic-action-bar">
        <button
          v-if="onResend"
          type="button"
          class="monotonic-chip-btn noobot-chip-action-btn is-primary"
          :disabled="disabled || operating"
          @click="handleEdit"
        >
          <svg class="monotonic-btn-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          {{ t("message.monotonicEdit") }}
        </button>
        <button
          v-if="onDelete"
          type="button"
          class="monotonic-chip-btn noobot-chip-action-btn is-danger"
          :disabled="disabled || operating"
          @click="handleDelete"
        >
          <svg class="monotonic-btn-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          {{ t("message.monotonicDelete") }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.monotonic-message-actions {
  width: 100%;
  margin-top: 12px;
}

/* Action Bar (View Mode) */
.monotonic-action-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  opacity: 0.9;
  transition: opacity 0.2s ease;
}

.monotonic-action-bar:hover {
  opacity: 1;
}

.monotonic-chip-btn {
  height: 30px;
}

.monotonic-btn-icon {
  flex-shrink: 0;
}

/* Edit Card */
.monotonic-edit-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  transition: box-shadow 0.3s ease;
}

.monotonic-edit-card:hover {
  box-shadow: none;
}

.monotonic-edit-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.monotonic-edit-title {
  color: var(--el-text-color-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.monotonic-edit-subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.4;
}

.monotonic-mode-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 4px;
  font-weight: 600;
  padding: 0 10px;
  height: 26px;
  line-height: 26px;
  white-space: nowrap;
}

.monotonic-mode-tag :deep(.el-tag__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  line-height: 1;
}

.monotonic-mode-icon,
.monotonic-tip-icon,
.monotonic-add-attachment-btn svg,
.monotonic-footer-btn svg {
  display: block;
  flex-shrink: 0;
}

.monotonic-edit-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Textarea */
.monotonic-edit-textarea :deep(.el-textarea__inner) {
  padding: 14px 16px;
  border-radius: var(--noobot-radius-xs);
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  border: none;
  box-shadow: inset 0 0 0 1px transparent;
  font-size: 14px;
  line-height: 1.6;
  transition: all 0.2s ease;
}

.monotonic-edit-textarea :deep(.el-textarea__inner:hover) {
  background: var(--el-fill-color);
}

.monotonic-edit-textarea :deep(.el-textarea__inner:focus) {
  background: var(--el-bg-color);
  box-shadow: inset 0 0 0 1px var(--el-color-primary), 0 0 0 2px var(--el-color-primary-light-8);
}

/* Attachments Area */
.monotonic-edit-attachments {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.monotonic-attachment-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.monotonic-attachment-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.monotonic-attachment-stats {
  display: flex;
  gap: 6px;
}

.stat-tag {
  border: none;
  font-weight: 500;
}

.monotonic-attachment-empty {
  padding: 16px;
}

.monotonic-attachment-empty :deep(.el-empty__description p) {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.monotonic-attachment-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
  padding-right: 8px; /* For scrollbar */
}

.monotonic-attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  transition: all 0.2s ease;
  position: relative;
}

.monotonic-attachment-item:hover {
  box-shadow: none;
  transform: translateY(-1px);
}

.monotonic-attachment-preview,
.monotonic-attachment-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--noobot-radius-xs);
  overflow: hidden;
}

.monotonic-attachment-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-size: 11px;
  font-weight: bold;
  border: 1px solid var(--el-color-primary-light-8);
}

.monotonic-attachment-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.monotonic-attachment-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.monotonic-attachment-desc {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kind-tag {
  height: 18px;
  padding: 0 6px;
  font-size: 10px;
  border: none;
}

.dot {
  margin: 0 4px;
  color: var(--el-text-color-placeholder);
}

.desc-text {
  flex-shrink: 0;
}

.monotonic-attachment-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  opacity: 0;
  transform: scale(0.9);
  transition: all 0.2s ease;
}

.monotonic-attachment-item:hover .monotonic-attachment-remove {
  opacity: 1;
  transform: scale(1);
}

.monotonic-attachment-remove:hover {
  background: var(--el-color-danger);
  color: white;
}

.monotonic-file-input {
  display: none;
}

.monotonic-add-attachment-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  border-radius: var(--noobot-radius-sm);
  border: 1px dashed var(--el-border-color-dark);
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.monotonic-add-attachment-btn:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.monotonic-add-attachment-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  border-color: var(--el-border-color-lighter);
}

/* Footer */
.monotonic-edit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.monotonic-edit-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.monotonic-edit-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.monotonic-footer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 20px;
  font-weight: 500;
}

.monotonic-footer-btn :deep(.el-button__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  line-height: 1;
}

:root[data-theme="dark"] .monotonic-edit-card,
html.dark .monotonic-edit-card,
.dark .monotonic-edit-card {
  background: var(--noobot-panel-bg);
  border-color: var(--noobot-panel-border);
}

:root[data-theme="dark"] .monotonic-edit-textarea :deep(.el-textarea__inner),
html.dark .monotonic-edit-textarea :deep(.el-textarea__inner),
.dark .monotonic-edit-textarea :deep(.el-textarea__inner) {
  color: var(--noobot-text-main);
  background: var(--noobot-control-bg);
  box-shadow: var(--noobot-input-ring);
}

:root[data-theme="dark"] .monotonic-edit-textarea :deep(.el-textarea__inner:hover),
html.dark .monotonic-edit-textarea :deep(.el-textarea__inner:hover),
.dark .monotonic-edit-textarea :deep(.el-textarea__inner:hover) {
  background: var(--noobot-surface-soft-hover);
}

:root[data-theme="dark"] .monotonic-edit-textarea :deep(.el-textarea__inner:focus),
html.dark .monotonic-edit-textarea :deep(.el-textarea__inner:focus),
.dark .monotonic-edit-textarea :deep(.el-textarea__inner:focus) {
  background: var(--noobot-surface-soft-hover);
  box-shadow: var(--noobot-input-ring-focus), var(--noobot-focus-ring);
}

:root[data-theme="dark"] .monotonic-attachment-empty,
html.dark .monotonic-attachment-empty,
.dark .monotonic-attachment-empty,
:root[data-theme="dark"] .monotonic-attachment-item,
html.dark .monotonic-attachment-item,
.dark .monotonic-attachment-item {
  background: var(--noobot-control-bg);
  border-color: var(--noobot-panel-border);
}

:root[data-theme="dark"] .monotonic-attachment-item:hover,
html.dark .monotonic-attachment-item:hover,
.dark .monotonic-attachment-item:hover {
  background: var(--noobot-attachment-hover-bg);
  border-color: var(--noobot-attachment-hover-border);
}

:root[data-theme="dark"] .monotonic-attachment-icon,
html.dark .monotonic-attachment-icon,
.dark .monotonic-attachment-icon {
  background: var(--noobot-attachment-icon-bg);
  border-color: var(--noobot-attachment-icon-border);
  color: var(--noobot-attachment-icon-text);
}

:root[data-theme="dark"] .monotonic-add-attachment-btn:hover:not(:disabled),
html.dark .monotonic-add-attachment-btn:hover:not(:disabled),
.dark .monotonic-add-attachment-btn:hover:not(:disabled) {
  background: var(--noobot-attachment-icon-bg);
  border-color: var(--noobot-border-primary);
}

:root[data-theme="dark"] .monotonic-edit-footer,
html.dark .monotonic-edit-footer,
.dark .monotonic-edit-footer {
  border-top-color: var(--noobot-footer-border);
}

@media (max-width: 640px) {
  .monotonic-edit-card {
    padding: 12px;
  }

  .monotonic-edit-heading {
    flex-direction: column;
    gap: 10px;
  }

  .monotonic-edit-footer {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .monotonic-edit-buttons {
    justify-content: flex-end;
  }

  .monotonic-attachment-list {
    grid-template-columns: 1fr;
  }
  
  .monotonic-attachment-remove {
    opacity: 1;
    transform: scale(1);
    background: var(--el-fill-color-darker);
  }
}
</style>