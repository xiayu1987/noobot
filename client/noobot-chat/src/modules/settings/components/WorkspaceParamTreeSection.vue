<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { Key } from "@element-plus/icons-vue";

const props = defineProps({
  name: { type: String, required: true },
  title: { type: String, required: true },
  itemClass: { type: [String, Array, Object], default: "" },
  treeData: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  translate: { type: Function, required: true },
});

const emit = defineEmits(["insert-param"]);
</script>

<template>
  <el-collapse-item
    :name="name"
    :title="title"
    class="resource-collapse-item"
    :class="itemClass"
  >
    <el-scrollbar class="tree-scroll" v-loading="loading" element-loading-background="var(--noobot-mask-bg)">
      <el-tree :data="treeData" node-key="key" :props="{ label: 'label', children: 'children' }" class="custom-tree param-tree">
        <template #default="{ data }">
          <span class="tree-node param-row" @dblclick.stop="emit('insert-param', data.key)">
            <el-icon class="node-icon"><Key /></el-icon>
            <span class="node-label">{{ data.label }}</span>
            <span class="param-desc" :title="data.description">{{ data.description || translate("settings.noDescription") }}</span>
          </span>
        </template>
      </el-tree>
      <div v-if="!treeData.length && !loading" class="empty-tip left-empty">
        <p>{{ translate("settings.noParams") }}</p>
      </div>
    </el-scrollbar>
  </el-collapse-item>
</template>

<style scoped>
.tree-node {
  width: 100%;
  min-width: 0;
}

.node-icon {
  color: var(--noobot-text-secondary);
}

.param-row {
  cursor: pointer;
}

.param-desc {
  margin-left: auto;
  color: var(--noobot-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.left-empty {
  position: static;
  min-height: 80px;
}

.empty-tip :deep(.el-empty__description p) {
  color: var(--noobot-text-muted);
}
</style>
