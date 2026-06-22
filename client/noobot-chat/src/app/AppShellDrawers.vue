<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import ChatMessageNavigator from "./ChatMessageNavigator.vue";

defineProps({
  drawerPanels: { type: Array, default: () => [] },
  drawerSize: { type: [String, Number], default: "50%" },
  isMobile: { type: Boolean, default: false },
  mobileChatNavigatorVisible: { type: Boolean, default: false },
  chatMessageNavItems: { type: Array, default: () => [] },
  currentMessageAnchorId: { type: String, default: "" },
  translate: { type: Function, default: (key) => key },
});

const emit = defineEmits([
  "drawer-model-update",
  "update:mobile-chat-navigator-visible",
  "mobile-chat-navigator-closed",
  "select-chat-message-nav-item",
]);
</script>

<template>
  <el-drawer
    v-for="drawer in drawerPanels"
    :key="drawer.key"
    :model-value="drawer.model.value"
    @update:model-value="emit('drawer-model-update', drawer, $event)"
    :title="drawer.title"
    :size="drawerSize"
    destroy-on-close
    class="workspace-drawer noobot-side-drawer"
  >
    <component
      :is="drawer.component"
      v-bind="drawer.props"
      @workspace-reset="drawer.onWorkspaceReset?.()"
    />
  </el-drawer>

  <el-drawer
    v-if="isMobile"
    :model-value="mobileChatNavigatorVisible"
    @update:model-value="emit('update:mobile-chat-navigator-visible', $event)"
    :title="translate('common.chatNavigator')"
    @closed="emit('mobile-chat-navigator-closed')"
    direction="rtl"
    size="82%"
    class="chat-message-nav-drawer noobot-side-drawer"
  >
    <ChatMessageNavigator
      :items="chatMessageNavItems"
      :current-id="currentMessageAnchorId"
      @select="emit('select-chat-message-nav-item', $event)"
    />
  </el-drawer>
</template>
