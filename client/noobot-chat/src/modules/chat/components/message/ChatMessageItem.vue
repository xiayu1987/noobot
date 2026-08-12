<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import SharedChatMessageItem from "./SharedChatMessageItem.vue";
import { chatMessageItemProps } from "../../model/messageItemProps.js";

defineEmits(["open-thinking-details"]);

const props = defineProps(chatMessageItemProps);
</script>

<template>
  <SharedChatMessageItem
    v-bind="props"
    @open-thinking-details="$emit('open-thinking-details', $event)"
  />
</template>
