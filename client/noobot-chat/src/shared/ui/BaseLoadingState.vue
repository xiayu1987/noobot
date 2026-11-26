<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { ElSkeleton } from "element-plus";
import { useLocale } from "../i18n/useLocale.js";
import "../styles/components/loading.css";

const props = defineProps({
  text: { type: String, default: "" },
  overlay: { type: Boolean, default: false },
});
const { translate } = useLocale();
const label = computed(() => props.text || translate("common.loading"));
</script>

<template>
  <div
    class="noobot-loading-state"
    :class="{ 'is-overlay': overlay }"
    role="status"
    :aria-label="label"
    aria-live="polite"
  >
    <ElSkeleton :rows="5" animated aria-hidden="true" />
  </div>
</template>
