<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
/**
 * 本轮消息操作装配层：编排查看态操作栏与编辑重发卡片两个子视图，
 * 并把附件编辑态（composable）、本地翻译器与删除/重发动作串起来。
 */
import { nextTick, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { createLocalTranslator } from "./monotonicMessageActions/localTranslations.js";
import { useMonotonicEditAttachments } from "./monotonicMessageActions/useMonotonicEditAttachments.js";
import MonotonicActionBar from "./monotonicMessageActions/MonotonicActionBar.vue";
import MonotonicEditCard from "./monotonicMessageActions/MonotonicEditCard.vue";

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
const editCardRef = ref(null);

const t = createLocalTranslator((key, fallback) => props.translate(key, fallback));

const {
  editAttachments,
  attachmentStats,
  initEditAttachments,
  addFiles,
  removeEditAttachment,
  buildEditAttachmentPayload,
  clearEditAttachments,
} = useMonotonicEditAttachments({
  getMessageItem: () => props.messageItem,
  operating,
});

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
  nextTick(() => editCardRef.value?.focusTextarea?.());
}

function handleCancelEdit() {
  if (operating.value) return;
  markEditing(false);
  draftContent.value = "";
  clearEditAttachments();
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
    clearEditAttachments();
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
    <MonotonicEditCard
      v-if="editing"
      ref="editCardRef"
      v-model="draftContent"
      :disabled="disabled"
      :operating="operating"
      :edit-attachments="editAttachments"
      :attachment-stats="attachmentStats"
      :t="t"
      @send="handleSendEdited"
      @cancel="handleCancelEdit"
      @add-files="addFiles"
      @remove-attachment="removeEditAttachment"
    />

    <MonotonicActionBar
      v-else
      :disabled="disabled"
      :operating="operating"
      :show-resend="!!onResend"
      :show-delete="!!onDelete"
      :t="t"
      @edit="handleEdit"
      @delete="handleDelete"
    />
  </div>
</template>

<style scoped>
.monotonic-message-actions {
  width: 100%;
  margin-top: 12px;
}
</style>
