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
          popper-class="noobot-select-popper"
          @update:model-value="updateField('language', $event)"
        >
          <el-option label="简体中文" value="zh-CN" />
          <el-option label="English" value="en-US" />
        </el-select>
        <small>{{ messages.setup.languageHelp }}</small>
      </el-form-item>
      <el-form-item :label="messages.setup.model">
        <ModelPicker
          v-model:visible="modelPickerVisible"
          :model-value="form.model"
          :options="modelOptions"
          :translate="translateModelPicker"
          drawer-size="min(480px, 100vw)"
          :allow-default="false"
          :placeholder="messages.setup.model"
          @update:model-value="updateField('model', $event)"
        />
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
import { ref } from "vue";
import ModelPicker from "@noobot/client-shared/ui/model-picker";

const props = defineProps({
  form: { type: Object, required: true },
  modelOptions: { type: Array, default: () => [] },
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
  messages: { type: Object, required: true },
});
const emit = defineEmits(["submit", "update:form"]);

const modelPickerVisible = ref(false);
function translateModelPicker(key) {
  return key.split(".").reduce((node, segment) => node[segment], props.messages);
}
function updateField(key, value) {
  emit("update:form", { ...props.form, [key]: value });
}
</script>
