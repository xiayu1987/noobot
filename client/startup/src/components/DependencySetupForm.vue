<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <section class="setup-form">
    <p>{{ messages.dependencies.intro }}</p>
    <el-checkbox-group
      :model-value="selectedDependencies"
      class="dependency-list"
      @update:model-value="$emit('update:selectedDependencies', $event)"
    >
      <el-checkbox
        v-for="item in missingDependencies"
        :key="item.key"
        class="dependency-card"
        :value="item.key"
        border
      >
        <strong>{{ item.name }}</strong>
        <span>{{
          messages.dependencies[item.key] || messages.dependencies.optionalDescription
        }}</span>
      </el-checkbox>
    </el-checkbox-group>
    <small>
      {{ messages.dependencies.existingHelp }}
    </small>
    <el-alert
      v-if="error"
      class="form-error"
      :title="error"
      type="error"
      show-icon
      :closable="false"
    />
    <div class="actions">
      <el-button
        type="primary"
        :loading="installing"
        :disabled="selectedDependencies.length === 0"
        @click="$emit('install')"
      >
        {{ messages.dependencies.install }}
      </el-button>
      <el-button :loading="skipping" @click="$emit('skip')">{{
        messages.dependencies.skip
      }}</el-button>
    </div>
  </section>
</template>

<script setup>
defineProps({
  missingDependencies: { type: Array, default: () => [] },
  selectedDependencies: { type: Array, default: () => [] },
  error: { type: String, default: "" },
  installing: { type: Boolean, default: false },
  skipping: { type: Boolean, default: false },
  messages: { type: Object, required: true },
});
defineEmits(["install", "skip", "update:selectedDependencies"]);
</script>
