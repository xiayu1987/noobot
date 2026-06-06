<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../../../client/noobot-chat/src/shared/i18n/useLocale";
import { computed } from "vue";
import { BaseStatusChipsRow } from "../../../../client/noobot-chat/src/shared/ui";

const props = defineProps({
  pending: { type: Boolean, default: false },
  statusLabel: { type: String, default: "" },
  showSubTask: { type: Boolean, default: false },
  subTaskStatusText: { type: String, default: "" },
});
const { translate } = useLocale();
const statusItems = computed(() => {
  const list = [
    {
      key: "main",
      text: props.pending ? translate("message.generating") : props.statusLabel,
      done: !props.pending,
    },
  ];
  if (props.showSubTask) {
    list.push({
      key: "sub-task",
      text: props.subTaskStatusText,
      done: !props.pending,
    });
  }
  return list;
});
</script>

<template>
  <BaseStatusChipsRow :items="statusItems" />
</template>
