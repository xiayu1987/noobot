<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <el-form label-position="top" class="setup-form" @submit.prevent="$emit('submit')">
    <p>
      {{ messages.setup.intro }}
    </p>
    <div class="form-grid">
      <el-form-item :label="messages.setup.language">
        <el-select
          :model-value="form.language"
          class="startup-system-select"
          popper-class="startup-system-select-popper"
          @update:model-value="updateField('language', $event)"
        >
          <el-option label="简体中文" value="zh-CN" />
          <el-option label="English" value="en-US" />
        </el-select>
        <small>{{ messages.setup.languageHelp }}</small>
      </el-form-item>
      <el-form-item :label="messages.setup.model">
        <el-select
          :model-value="form.model"
          class="startup-system-select"
          popper-class="startup-system-select-popper"
          filterable
          @update:model-value="updateField('model', $event)"
        >
          <el-option
            v-for="item in modelOptions"
            :key="item.key"
            :label="formatModelLabel(item)"
            :value="item.key"
          />
        </el-select>
        <small>{{ messages.setup.modelHelp }}</small>
      </el-form-item>
      <el-form-item :label="messages.setup.username">
        <el-input
          :model-value="form.userId"
          autocomplete="username"
          :placeholder="messages.setup.usernamePlaceholder"
          @update:model-value="updateField('userId', $event)"
        />
        <small>{{ messages.setup.usernameHelp }}</small>
      </el-form-item>
      <el-form-item class="field-full" :label="messages.setup.connectCode">
        <el-input
          :model-value="form.connectCode"
          autocomplete="off"
          :placeholder="messages.setup.connectCodePlaceholder"
          show-password
          @update:model-value="updateField('connectCode', $event)"
        />
        <small>{{ messages.setup.connectCodeHelp }}</small>
      </el-form-item>
      <el-form-item class="field-full" :label="messages.setup.proxy">
        <el-input
          :model-value="form.dependencyProxyUrl"
          autocomplete="off"
          :placeholder="messages.setup.proxyPlaceholder"
          @update:model-value="updateField('dependencyProxyUrl', $event)"
        />
        <small>{{ messages.setup.proxyHelp }}</small>
      </el-form-item>
    </div>
    <el-alert
      v-if="error"
      class="form-error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
    />
    <div class="actions">
      <el-button native-type="submit" type="primary" :loading="saving">{{
        messages.setup.next
      }}</el-button>
    </div>
  </el-form>
</template>

<script setup>
const props = defineProps({
  form: { type: Object, required: true },
  modelOptions: { type: Array, default: () => [] },
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
  messages: { type: Object, required: true },
});
const emit = defineEmits(["submit", "update:form"]);

function formatModelLabel(item) {
  return [item?.key, item?.model, item?.description]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");
}
function updateField(key, value) {
  emit("update:form", { ...props.form, [key]: value });
}
</script>
