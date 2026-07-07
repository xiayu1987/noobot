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
  gap: 2px;
  margin-top: var(--noobot-space-md);
  padding-top: var(--noobot-space-sm);
  border-top: 1px dashed color-mix(in srgb, var(--noobot-cyber-cyan) 35%, transparent);
}
:deep(.base-file-card) {
  display: flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  padding: 4px var(--noobot-space-xs);
}
</style>
