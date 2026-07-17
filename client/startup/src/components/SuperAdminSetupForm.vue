<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <el-form class="setup-form" label-position="top" @submit.prevent="$emit('submit')">
    <p>Complete the required first-run setup. These values are saved only in your desktop user data directory.</p>
    <div class="form-grid">
      <el-form-item label="Language">
        <el-select :model-value="form.language" @update:model-value="updateField('language', $event)">
          <el-option label="简体中文" value="zh-CN" />
          <el-option label="English" value="en-US" />
        </el-select>
        <small>Used as the default Noobot interface and response language.</small>
      </el-form-item>
      <el-form-item label="Model">
        <el-select :model-value="form.model" filterable @update:model-value="updateField('model', $event)">
          <el-option v-for="item in modelOptions" :key="item.key" :label="formatModelLabel(item)" :value="item.key" />
        </el-select>
        <small>Used as the default model for global and default user configuration.</small>
      </el-form-item>
      <el-form-item label="Super admin username">
        <el-input :model-value="form.userId" autocomplete="username" placeholder="e.g. owner" @update:model-value="updateField('userId', $event)" />
        <small>Please use a non-default administrator name.</small>
      </el-form-item>
      <el-form-item class="field-full" label="Connect code">
        <el-input :model-value="form.connectCode" autocomplete="off" placeholder="Create a private connection code" show-password @update:model-value="updateField('connectCode', $event)" />
        <small>Keep this code private. It is used to connect as the super admin.</small>
      </el-form-item>
      <el-form-item class="field-full" label="Dependency download proxy">
        <el-input :model-value="form.dependencyProxyUrl" autocomplete="off" placeholder="Optional, e.g. http://127.0.0.1:7890 or socks5://127.0.0.1:7890" @update:model-value="updateField('dependencyProxyUrl', $event)" />
        <small>Optional. If set, Noobot checks it before saving and uses it when downloading dependencies on Windows/macOS.</small>
      </el-form-item>
      <div class="dependency-panel field-full">
        <div class="dependency-title"><label>Optional dependencies</label><el-tag size="small" type="primary" effect="plain">Auto skip installed</el-tag></div>
        <el-checkbox-group :model-value="selectedDependencies" class="dependency-list" @update:model-value="$emit('update:selectedDependencies', $event)">
          <el-checkbox v-for="item in dependencies" :key="item.key" class="dependency-card" :value="item.key" border>
            <strong>{{ item.name }}</strong>
            <span>{{ item.description }}</span>
          </el-checkbox>
        </el-checkbox-group>
        <small>Checked dependencies are installed only when missing. Setup shows a clear error if automatic installation is not available.</small>
      </div>
    </div>
    <el-alert v-if="error" class="form-error" :title="error" type="error" show-icon :closable="false" />
    <div class="actions"><el-button native-type="submit" type="primary" :loading="saving">Next</el-button></div>
  </el-form>
</template>

<script setup>
const props = defineProps({
  form: { type: Object, required: true },
  modelOptions: { type: Array, default: () => [] },
  dependencies: { type: Array, default: () => [] },
  selectedDependencies: { type: Array, default: () => [] },
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
});
const emit = defineEmits(["submit", "update:form", "update:selectedDependencies"]);

function formatModelLabel(item) {
  return [item?.key, item?.model, item?.description].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
}
function updateField(key, value) {
  emit("update:form", { ...props.form, [key]: value });
}
</script>
