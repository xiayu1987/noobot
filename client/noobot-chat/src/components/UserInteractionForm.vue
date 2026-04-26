<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { nextTick, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";

const props = defineProps({
  request: { type: Object, default: null },
  submitting: { type: Boolean, default: false },
});

const emit = defineEmits(["confirm", "cancel"]);

const formData = reactive({});
const firstInputRef = ref(null);

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
        ElMessage.warning(`${label} 为必填项`);
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
      <span class="interaction-badge">待确认</span>
      <div class="interaction-title">{{ request.content || "需要确认/补充信息" }}</div>
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
          :placeholder="fieldItem.description || `请输入${fieldItem.displayName || fieldItem.name}`"
        />
      </el-form-item>
    </el-form>

    <div class="interaction-actions">
      <el-button :disabled="submitting" @click="onCancel">
        取消
      </el-button>
      <el-button type="primary" :loading="submitting" @click="onConfirm">
        确认
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.interaction-card {
  position: relative;
  margin: 0 max(24px, calc(50% - 400px)) 12px;
  padding: 14px 16px;
  border: 1px solid #2c3a55;
  border-radius: 12px;
  background: #111827;
}

.interaction-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 0 4px 4px 0;
  background: linear-gradient(180deg, #facc15, #fb7185);
  box-shadow: 0 0 12px rgba(251, 113, 133, 0.6);
}

.interaction-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.interaction-badge {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: #111827;
  background: linear-gradient(135deg, #fde047, #fb7185);
  box-shadow: 0 0 12px rgba(251, 113, 133, 0.45);
}

.interaction-title {
  color: #e8efff;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 0;
}

.interaction-form :deep(.el-form-item__label) {
  color: #b9c8ea;
}

.interaction-form :deep(.el-input__wrapper) {
  background: #0f172a;
  border-color: #334155;
}

.interaction-form :deep(.el-input) {
  --el-input-text-color: #e8efff;
  --el-input-placeholder-color: #93a4c7;
}

.interaction-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .interaction-card {
    margin: 0 16px 10px;
  }
}
</style>
