<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  label: { type: String, default: "" },
  type: { type: String, default: "button" },
});

defineEmits(["click"]);
</script>

<template>
  <button
    :type="type"
    class="base-pill-btn noobot-flat-chip"
    @click="$emit('click')"
  >
    {{ label }}
  </button>
</template>

<style scoped>
.base-pill-btn {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  cursor: pointer;
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1.2;
  border-radius: 999px;
}

.base-pill-btn:hover {
  filter: brightness(1.08);
}
</style>
