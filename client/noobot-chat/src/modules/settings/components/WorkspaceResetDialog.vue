<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  sections: { type: Array, default: () => [] },
  title: { type: String, default: "" },
  sectionOptions: { type: Array, default: () => [] },
  confirmLoading: { type: Boolean, default: false },
  translate: { type: Function, required: true },
});

defineEmits([
  "update:visible",
  "update:sections",
  "select-all",
  "clear-all",
  "confirm",
]);
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="min(92vw, 420px)"
    append-to-body
    class="workspace-reset-dialog noobot-dialog-surface"
    @update:model-value="$emit('update:visible', $event)"
  >
    <div class="reset-dialog-tip noobot-flat-card">
      {{ translate("settings.resetDialogTipPrefix") }}
      <code>default-user</code> {{ translate("settings.resetDialogTipSuffix") }}
    </div>
    <div class="reset-dialog-toolbar">
      <el-button text size="small" @click="$emit('select-all')">{{ translate("settings.selectAll") }}</el-button>
      <el-button text size="small" @click="$emit('clear-all')">{{ translate("settings.clear") }}</el-button>
    </div>
    <el-checkbox-group
      :model-value="sections"
      class="reset-section-group"
      @update:model-value="$emit('update:sections', $event)"
    >
      <el-checkbox
        v-for="item in sectionOptions"
        :key="item.value"
        :value="item.value"
        :label="item.label"
        border
        class="reset-section-item"
      >
        {{ item.label }}
      </el-checkbox>
    </el-checkbox-group>
    <div class="reset-dialog-note">{{ translate("settings.resetDialogNote") }}</div>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">{{ translate("settings.cancel") }}</el-button>
      <el-button type="danger" :loading="confirmLoading" @click="$emit('confirm')">
        {{ translate("settings.confirmReset") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
:deep(.workspace-reset-dialog .el-dialog__header) {
  border-bottom: 1px solid var(--noobot-divider);
  margin-right: 0;
  padding-bottom: 12px;
}

:deep(.workspace-reset-dialog .el-dialog__title) {
  color: var(--noobot-text-main);
  font-weight: 600;
}

:deep(.workspace-reset-dialog .el-dialog__body) {
  padding-top: 14px;
}

:deep(.workspace-reset-dialog .el-dialog__footer) {
  border-top: 1px solid var(--noobot-divider);
}

.reset-section-group {
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(2, minmax(120px, 1fr));
  gap: 8px 12px;
}

.reset-dialog-tip {
  font-size: 13px;
  color: var(--noobot-text-secondary);
  line-height: 1.6;
  padding: 10px 12px;
  background: var(--noobot-panel-muted);
}

.reset-dialog-tip code {
  color: var(--noobot-text-accent);
}

.reset-dialog-toolbar {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.reset-section-item {
  margin-right: 0 !important;
}

.reset-dialog-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--noobot-text-muted);
}

@media (max-width: 768px) {
  .reset-section-group {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .reset-dialog-toolbar {
    justify-content: space-between;
  }

  :deep(.workspace-reset-dialog .el-dialog) {
    width: calc(100vw - 24px) !important;
    max-width: 560px;
    margin-top: 8vh !important;
  }

  :deep(.workspace-reset-dialog .el-dialog__body) {
    padding-left: 14px;
    padding-right: 14px;
  }

  :deep(.workspace-reset-dialog .el-dialog__footer) {
    padding: 10px 14px 14px;
    display: flex;
    gap: 8px;
  }

  :deep(.workspace-reset-dialog .el-dialog__footer .el-button) {
    flex: 1;
  }
}
</style>
