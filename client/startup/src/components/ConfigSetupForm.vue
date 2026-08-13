<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <el-form class="setup-form" label-position="top" @submit.prevent="$emit('submit')">
    <p>
      {{ messages.config.intro }}
    </p>
    <div class="form-grid">
      <el-form-item
        v-for="item in requiredParams"
        :key="item.key"
        class="field-full"
        :label="item.key"
      >
        <el-input
          :model-value="values[item.key]"
          autocomplete="off"
          @update:model-value="updateValue(item.key, $event)"
        />
        <small>{{ item.description || messages.config.valueHelp }}</small>
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
        messages.config.save
      }}</el-button>
      <el-button :loading="skipping" @click="$emit('skip')">{{ messages.config.skip }}</el-button>
    </div>
  </el-form>
</template>

<script setup>
const props = defineProps({
  requiredParams: { type: Array, default: () => [] },
  values: { type: Object, required: true },
  error: { type: String, default: "" },
  saving: { type: Boolean, default: false },
  skipping: { type: Boolean, default: false },
  messages: { type: Object, required: true },
});
const emit = defineEmits(["submit", "skip", "update:values"]);

function updateValue(key, value) {
  emit("update:values", { ...props.values, [key]: value });
}
</script>
