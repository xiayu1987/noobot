<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref } from "vue";
import ModelPicker from "@noobot/client-shared/ui/model-picker";
import { useLocale } from "../i18n/useLocale.js";
import { useMobileViewport } from "../composables/useMobileViewport.js";
import { useOverlayHistory } from "../composables/useOverlayHistory.js";

defineOptions({ inheritAttrs: false });
const emit = defineEmits(["update:modelValue"]);
const { translate } = useLocale();
const { drawerSize } = useMobileViewport();
const visible = ref(false);
useOverlayHistory(visible, () => (visible.value = false));
</script>

<template>
  <ModelPicker
    v-bind="$attrs"
    v-model:visible="visible"
    :translate="translate"
    :drawer-size="drawerSize"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
