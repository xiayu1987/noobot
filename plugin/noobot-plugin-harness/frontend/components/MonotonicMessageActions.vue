<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { translateHarnessFallback, useHarnessLocale } from "../i18n";

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
const { translate: translateHarness } = useHarnessLocale();
const attachmentStats = computed(() => {
  const items = Array.isArray(editAttachments.value) ? editAttachments.value : [];
  return {
    total: items.length,
    history: items.filter((item) => item?.kind === "history").length,
    added: items.filter((item) => item?.kind === "new").length,
  };
});

function t(key) {
  const fallbackTranslated = translateHarnessFallback(key);
  const translated = props.translate(key, fallbackTranslated);
  if (translated && translated !== key) return translated;
  const localTranslated = translateHarness(key);
  return localTranslated && localTranslated !== key ? localTranslated : fallbackTranslated;
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
      <el-card class="monotonic-edit-card" shadow="never">
        <div class="monotonic-edit-heading">
          <div class="monotonic-edit-heading-copy">
            <div class="monotonic-edit-title">编辑并重发</div>
            <div class="monotonic-edit-subtitle">调整内容和附件后，将替换本轮消息并重新生成回复</div>
          </div>
          <el-tag type="primary" effect="light" round>重发模式</el-tag>
        </div>
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
              <span class="monotonic-attachment-title">附件</span>
              <span class="monotonic-attachment-subtitle">本次重发会携带下方最终附件列表</span>
            </div>
            <div class="monotonic-attachment-stats">
              <el-tag size="small" effect="plain" round>{{ attachmentStats.total }} 个</el-tag>
              <el-tag v-if="attachmentStats.history" size="small" type="info" effect="light" round>原 {{ attachmentStats.history }}</el-tag>
              <el-tag v-if="attachmentStats.added" size="small" type="success" effect="light" round>新 {{ attachmentStats.added }}</el-tag>
            </div>
          </div>
          <el-empty
            v-if="!editAttachments.length"
            class="monotonic-attachment-empty"
            :image-size="42"
            description="暂无附件，可点击下方按钮添加"
          />
          <el-scrollbar v-else max-height="168px" class="monotonic-attachment-scroll">
            <div class="monotonic-attachment-list">
              <el-card
                v-for="(attachment, index) in editAttachments"
                :key="attachment.key || index"
                class="monotonic-attachment-item"
                shadow="hover"
              >
                <div class="monotonic-attachment-body">
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
                    <div class="monotonic-attachment-tags">
                      <el-tag size="small" :type="attachment.kind === 'new' ? 'success' : 'info'" effect="light">
                        {{ attachment.kind === 'new' ? '新增' : '原附件' }}
                      </el-tag>
                    </div>
                    <div class="monotonic-attachment-desc">
                      <span>{{ attachmentTypeLabel(attachment) }}</span>
                      <span aria-hidden="true">·</span>
                      <span>{{ formatAttachmentSize(attachment.size) }}</span>
                    </div>
                  </div>
                  <el-button
                    class="monotonic-attachment-remove"
                    circle
                    size="small"
                    type="danger"
                    plain
                    :disabled="operating"
                    @click="removeEditAttachment(index)"
                  >×</el-button>
                </div>
              </el-card>
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
          <el-button
            class="monotonic-add-attachment-btn"
            type="primary"
            plain
            :disabled="disabled || operating"
            @click="handleChooseFiles"
          >
            ＋ 添加附件
          </el-button>
        </div>
        <div class="monotonic-edit-footer">
          <span class="monotonic-edit-tip">
            {{ t("message.monotonicEditTip") }}
          </span>
          <div class="monotonic-edit-buttons">
            <el-button
              class="monotonic-footer-btn"
              :disabled="operating"
              @click="handleCancelEdit"
            >
              {{ t("common.cancel") }}
            </el-button>
            <el-button
              class="monotonic-footer-btn"
              type="primary"
              :loading="operating"
              :disabled="disabled || operating || !String(draftContent || '').trim()"
              @click="handleSendEdited"
            >
              {{ t("message.monotonicSendEdited") }}
            </el-button>
          </div>
        </div>
      </el-card>
    </template>
    <template v-else>
      <div class="monotonic-action-bar">
        <button
          v-if="onResend"
          type="button"
          class="monotonic-chip-btn edit"
          :disabled="disabled || operating"
          @click="handleEdit"
        >
          <span class="monotonic-btn-icon">✎</span>
          {{ t("message.monotonicEdit") }}
        </button>
        <button
          v-if="onDelete"
          type="button"
          class="monotonic-chip-btn delete"
          :disabled="disabled || operating"
          @click="handleDelete"
        >
          <span class="monotonic-btn-icon">⌫</span>
          {{ t("message.monotonicDelete") }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.monotonic-message-actions {
  width: 100%;
  margin-top: 10px;
}

.monotonic-action-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  opacity: 0.88;
}

.monotonic-chip-btn {
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.monotonic-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  background: var(--noobot-btn-secondary-bg, var(--el-fill-color-light));
  border-color: color-mix(in srgb, var(--noobot-btn-secondary-border, var(--el-border-color)) 62%, transparent);
}

.monotonic-chip-btn.edit:hover:not(:disabled) {
  color: var(--noobot-text-strong, var(--el-text-color-primary));
  background: var(--noobot-btn-secondary-bg-hover, var(--el-fill-color));
  border-color: color-mix(in srgb, var(--el-color-primary) 28%, var(--noobot-panel-border, var(--el-border-color)));
  box-shadow: 0 8px 18px color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  transform: translateY(-1px);
}

.monotonic-chip-btn.delete {
  color: var(--el-color-danger);
}

.monotonic-chip-btn.delete:hover:not(:disabled) {
  background: color-mix(in srgb, var(--el-color-danger) 10%, var(--noobot-btn-secondary-bg-hover, var(--el-fill-color)));
  border-color: color-mix(in srgb, var(--el-color-danger) 34%, var(--noobot-panel-border, var(--el-border-color)));
  transform: translateY(-1px);
}

.monotonic-chip-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.monotonic-btn-icon {
  font-size: 13px;
  line-height: 1;
}

.monotonic-edit-card {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border, var(--el-border-color)) 78%, transparent);
  border-radius: var(--noobot-radius-lg, 16px);
  background: var(--noobot-panel-bg, var(--el-bg-color-overlay));
  box-shadow: var(--noobot-card-shadow, var(--el-box-shadow-light));
  color: var(--noobot-text-main, var(--el-text-color-primary));
}

.monotonic-edit-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
}

.monotonic-edit-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 2px 2px 0;
}

.monotonic-edit-heading-copy {
  min-width: 0;
  padding-right: 8px;
}

.monotonic-edit-title {
  color: var(--noobot-text-strong, var(--el-text-color-primary));
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
}

.monotonic-edit-subtitle {
  margin-top: 3px;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  font-size: 12px;
  line-height: 1.35;
}

.monotonic-edit-textarea :deep(.el-textarea__inner) {
  padding: 12px 14px;
  border-radius: var(--noobot-radius-md, 14px);
  color: var(--noobot-text-main, var(--el-text-color-primary));
  background: var(--noobot-control-bg, var(--el-fill-color-blank));
  border-color: var(--noobot-panel-border, var(--el-border-color));
  box-shadow: none;
  line-height: 1.58;
}

.monotonic-edit-attachments {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--noobot-radius-md, 14px);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 18%, var(--noobot-panel-border, var(--el-border-color)));
  background: var(--noobot-panel-bg, var(--el-bg-color));
}

.monotonic-attachment-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.monotonic-attachment-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.monotonic-attachment-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--noobot-text-strong, var(--el-text-color-primary));
}

.monotonic-attachment-subtitle {
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  font-size: 12px;
  line-height: 1.45;
}

.monotonic-attachment-stats {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.monotonic-attachment-empty {
  padding: 14px 16px 12px;
  border-radius: var(--noobot-radius-md, 12px);
  background: color-mix(in srgb, var(--el-color-primary-light-9, var(--el-fill-color-light)) 72%, var(--noobot-panel-bg, var(--el-bg-color)));
}

.monotonic-attachment-empty :deep(.el-empty__description) {
  margin-top: 4px;
}

.monotonic-attachment-empty :deep(.el-empty__description p) {
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  font-size: 12px;
}

.monotonic-attachment-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 260px));
  justify-content: flex-start;
  gap: 14px;
  padding: 8px 12px 10px 6px;
}

.monotonic-attachment-item {
  position: relative;
  overflow: hidden;
  border-radius: var(--noobot-radius-md, 12px);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 24%, var(--noobot-panel-border, var(--el-border-color)));
  background: color-mix(in srgb, var(--el-color-primary-light-9, var(--el-bg-color-overlay)) 36%, var(--el-bg-color-overlay, var(--noobot-panel-bg, var(--el-bg-color))));
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.monotonic-attachment-item:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 46%, var(--noobot-panel-border, var(--el-border-color)));
  box-shadow: 0 8px 20px color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  transform: translateY(-1px);
}

.monotonic-attachment-item :deep(.el-card__body) {
  padding: 0;
}

.monotonic-attachment-body {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 34px;
  align-items: start;
  column-gap: 14px;
  min-width: 0;
  width: 100%;
  padding: 16px;
}

.monotonic-attachment-preview,
.monotonic-attachment-icon {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 16%, var(--noobot-panel-border, var(--el-border-color)));
}

.monotonic-attachment-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary-dark-2, var(--el-color-primary));
  background: color-mix(in srgb, var(--el-color-primary) 16%, var(--el-bg-color-overlay, var(--el-fill-color-light)));
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.monotonic-attachment-meta {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: 9px;
  padding: 0;
}

.monotonic-attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-primary, var(--noobot-text-strong));
  font-size: 13px;
  font-weight: 750;
  line-height: 1.45;
}

.monotonic-attachment-tags {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.monotonic-attachment-tags :deep(.el-tag) {
  max-width: 100%;
  height: 22px;
  padding: 0 8px;
  border-color: color-mix(in srgb, currentColor 42%, transparent);
  font-weight: 700;
}

.monotonic-attachment-desc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-primary, var(--noobot-text-main));
  font-size: 11.5px;
  font-weight: 650;
  line-height: 1.5;
  opacity: 0.92;
}

.monotonic-attachment-remove {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  margin: 0;
  opacity: 0.92;
  color: var(--el-color-danger);
  background: var(--el-bg-color-overlay, var(--el-bg-color));
  border-color: color-mix(in srgb, var(--el-color-danger) 28%, var(--el-border-color));
  transition: opacity 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
}

.monotonic-attachment-remove:hover:not(:disabled) {
  color: var(--el-fill-color-blank, var(--el-bg-color));
  background: var(--el-color-danger);
  border-color: var(--el-color-danger);
}

.monotonic-attachment-item:hover .monotonic-attachment-remove {
  opacity: 1;
  transform: scale(1.04);
}

.monotonic-file-input {
  display: none;
}

.monotonic-add-attachment-btn {
  align-self: flex-start;
  border-radius: 999px;
  font-weight: 600;
}

.monotonic-edit-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.monotonic-edit-tip {
  min-width: 0;
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  font-size: 12px;
  line-height: 1.35;
}

.monotonic-edit-buttons {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.monotonic-footer-btn {
  border-radius: var(--noobot-btn-radius, 10px);
}

@media (max-width: 640px) {
  .monotonic-edit-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .monotonic-edit-buttons {
    justify-content: flex-end;
  }

  .monotonic-edit-heading,
  .monotonic-attachment-header {
    align-items: stretch;
    flex-direction: column;
  }

  .monotonic-attachment-stats {
    justify-content: flex-start;
  }

  .monotonic-attachment-list {
    grid-template-columns: 1fr;
    padding: 8px 6px 10px;
  }

  .monotonic-attachment-body {
    grid-template-columns: 44px minmax(0, 1fr) 34px;
    column-gap: 12px;
    padding: 14px;
  }
}
</style>
