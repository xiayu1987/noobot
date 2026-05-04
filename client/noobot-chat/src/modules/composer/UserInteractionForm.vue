<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { nextTick, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useLocale } from "../../shared/i18n/useLocale";

const props = defineProps({
  request: { type: Object, default: null },
  submitting: { type: Boolean, default: false },
});

const emit = defineEmits(["confirm", "cancel"]);

const formData = reactive({});
const firstInputRef = ref(null);
const { t } = useLocale();

function setFirstInputRef(el) {
  firstInputRef.value = el || null;
}

function resetForm() {
  const fields = Array.isArray(props.request?.fields) ? props.request.fields : [];
  for (const key of Object.keys(formData)) {
    delete formData[key];
  }
  for (const fieldItem of fields) {
    const key = String(fieldItem?.name || "").trim();
    if (!key) continue;
    const defaultValue =
      fieldItem?.defaultValue ?? fieldItem?.default_value ?? "";
    formData[key] = String(defaultValue || "");
  }
}

function onConfirm() {
  if (props.submitting) return;
  const fields = Array.isArray(props.request?.fields) ? props.request.fields : [];
  if (fields.length) {
    const payload = {};
    for (const fieldItem of fields) {
      const key = String(fieldItem?.name || "").trim();
      if (!key) continue;
      const value = String(formData[key] || "");
      if (fieldItem?.required && !value.trim()) {
        const label = String(fieldItem?.displayName || fieldItem?.name || key);
        ElMessage.warning(t("composer.fieldRequired", { label }));
        return;
      }
      payload[key] = value;
    }
    emit("confirm", payload);
    return;
  }
  emit("confirm", { response: "confirmed" });
}

function onCancel() {
  emit("cancel");
}

watch(
  () => props.request?.requestId,
  async () => {
    resetForm();
    await nextTick();
    firstInputRef.value?.focus?.();
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="request" class="interaction-card">
    <div class="interaction-head">
      <span class="interaction-badge">{{ t("composer.pendingConfirm") }}</span>
      <div class="interaction-title">{{ request.content || t("composer.confirmOrSupplement") }}</div>
    </div>

    <el-form
      v-if="Array.isArray(request.fields) && request.fields.length"
      label-position="top"
      class="interaction-form"
      @keydown.enter.prevent="onConfirm"
    >
      <el-form-item
        v-for="(fieldItem, index) in request.fields"
        :key="`${fieldItem.name}-${index}`"
        :label="`${fieldItem.displayName || fieldItem.name}${fieldItem.required ? ' *' : ''}`"
      >
        <el-input
          :ref="index === 0 ? setFirstInputRef : null"
          v-model="formData[fieldItem.name]"
          :placeholder="fieldItem.description || t('composer.inputField', { field: fieldItem.displayName || fieldItem.name })"
        />
      </el-form-item>
    </el-form>

    <div class="interaction-actions">
      <el-button :disabled="submitting" @click="onCancel">
        {{ t("common.cancel") }}
      </el-button>
      <el-button type="primary" :loading="submitting" @click="onConfirm">
        {{ t("infra.confirm") }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.interaction-card {
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 0 max(24px, calc(50% - 400px)) 12px;
  padding: 14px 16px;
  border: 1px solid var(--noobot-panel-border);
  border-radius: 12px;
  background: var(--noobot-panel-bg);
  max-height: min(72vh, 560px);
  overflow: hidden;
}

.interaction-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 0 4px 4px 0;
  background: var(--noobot-text-accent);
  box-shadow: none;
}

.interaction-head {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
  flex: 0 0 auto;
}

.interaction-badge {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: var(--noobot-text-strong);
  background: var(--noobot-panel-muted);
  box-shadow: none;
}

.interaction-title {
  color: var(--noobot-text-main);
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 0;
  line-height: 1.5;
  word-break: break-word;
}

.interaction-form :deep(.el-form-item__label) {
  color: var(--noobot-text-secondary);
}

.interaction-form {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.interaction-form :deep(.el-input__wrapper) {
  background: transparent;
  border-color: var(--noobot-panel-border);
}

.interaction-form :deep(.el-input) {
  --el-input-text-color: var(--noobot-text-main);
  --el-input-placeholder-color: var(--noobot-text-muted);
}

.interaction-actions {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--noobot-panel-border);
  background: var(--noobot-panel-bg);
}

.interaction-actions :deep(.el-button) {
  min-width: 88px;
}

@media (max-width: 768px) {
  .interaction-card {
    margin: 0 12px 10px;
    padding: 12px;
    max-height: 62vh;
  }

  .interaction-actions {
    justify-content: stretch;
  }

  .interaction-actions :deep(.el-button) {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
