<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <section class="setup-form">
    <p>Install missing optional dependencies now, or continue without them.</p>
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
        <span>{{ item.description }}</span>
      </el-checkbox>
    </el-checkbox-group>
    <small>
      Existing installations are detected automatically. Skipping only affects this startup; this
      choice will be offered again while dependencies remain missing.
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
        Install selected
      </el-button>
      <el-button :loading="skipping" @click="$emit('skip')">Skip for now</el-button>
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
});
defineEmits(["install", "skip", "update:selectedDependencies"]);
</script>
