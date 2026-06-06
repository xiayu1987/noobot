<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<template>
  <div class="base-file-card-list">
    <slot name="header"></slot>
    <slot></slot>
  </div>
</template>

<style scoped>
.base-file-card-list {
  display: flex;
  flex-direction: column;
  gap: var(--noobot-space-xs);
  margin-top: var(--noobot-space-lg);
  padding-top: var(--noobot-space-md);
  border-top: 1px dashed color-mix(in srgb, var(--noobot-cyber-cyan) 35%, transparent);
}
:deep(.base-file-card) {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-sm);
  padding: var(--noobot-space-xs) var(--noobot-space-sm);
}
</style>
