<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { useLocale } from "../../../../client/noobot-chat/src/shared/i18n/useLocale";
import { computed } from "vue";

const props = defineProps({
  pending: { type: Boolean, default: false },
  statusLabel: { type: String, default: "" },
  showSubTask: { type: Boolean, default: false },
  subTaskStatusText: { type: String, default: "" },
  statusStepState: { type: String, default: "" },
});
const { translate } = useLocale();
const stepView = computed(() => {
  const terminal = ["completed", "stopped", "error"].includes(props.statusStepState)
    ? props.statusStepState
    : "completed";
  const steps = [
    { key: "requesting", title: translate("composer.requesting") },
    { key: "sending", title: translate("composer.sending") },
    { key: "completing", title: translate("composer.completing") },
    {
      key: terminal,
      title: terminal === "stopped"
        ? translate("composer.turnStopped")
        : terminal === "error"
          ? translate("composer.turnFailed")
          : translate("composer.turnCompleted"),
    },
  ];
  const activeByState = { requesting: 0, sending: 1, completing: 2, stopping: 2, completed: 4, stopped: 4, error: 4 };
  return {
    steps,
    active: activeByState[props.statusStepState] ?? 0,
    finishStatus: terminal === "error" ? "error" : terminal === "stopped" ? "warning" : "success",
  };
});
</script>

<template>
  <div
    v-if="statusStepState"
    class="message-status-steps"
    :class="[
      `is-${stepView.finishStatus}`,
      { 'is-running': !['completed', 'stopped', 'error'].includes(statusStepState) },
    ]"
    role="status"
    aria-live="polite"
  >
    <el-steps :active="stepView.active" :finish-status="stepView.finishStatus" align-center>
      <el-step v-for="step in stepView.steps" :key="step.key" :title="step.title" />
    </el-steps>
  </div>
</template>

<style scoped>
/* 1. 胶囊式极简容器 */
.message-status-steps {
  width: fit-content;
  min-width: 280px;
  max-width: 100%;
  margin: 6px 0 10px;
  padding: 12px 24px 8px; /* 调整内边距适应小圆点 */
  border-radius: 99px; /* 胶囊圆角 */
  color: var(--noobot-text-secondary, var(--el-text-color-regular));
  background: var(--noobot-control-bg, var(--noobot-panel-bg, var(--el-fill-color-light)));
  border: 1px solid var(--noobot-panel-border, var(--el-border-color-lighter));
  transition: all 0.3s ease;
}

.message-status-steps.is-running {
  background: color-mix(in srgb, var(--el-color-primary) 8%, var(--noobot-control-bg, var(--el-fill-color-light)));
}
.message-status-steps.is-error {
  background: color-mix(in srgb, var(--el-color-danger) 8%, var(--noobot-control-bg, var(--el-fill-color-light)));
}
.message-status-steps.is-warning {
  background: color-mix(in srgb, var(--el-color-warning) 8%, var(--noobot-control-bg, var(--el-fill-color-light)));
}

/* 2. 隐藏默认的粗糙元素，重塑节点为“微型圆点” */
.message-status-steps :deep(.el-step__icon) {
  width: 6px !important;
  height: 6px !important;
  border: none !important;
  border-radius: 50%;
  background-color: var(--noobot-panel-border, var(--el-border-color-dark));
  transition: all 0.3s ease;
}

/* 隐藏图标内部的文字或勾选符号 */
.message-status-steps :deep(.el-step__icon-inner) {
  display: none !important;
}

/* 3. 调整连接线，使其与 6px 的小圆点居中对齐 */
.message-status-steps :deep(.el-step__line) {
  top: 3px !important; /* (6px圆点 / 2) */
  height: 1px !important;
  background-color: var(--noobot-panel-border, var(--el-border-color-lighter));
  left: 50% !important;
  right: -50% !important;
}
.message-status-steps :deep(.el-step__line-inner) {
  border-width: 0 !important; /* 禁用默认的进度线动画，保持极简 */
}

/* 4. 字体排版：极简、小巧、柔和 */
.message-status-steps :deep(.el-step__title) {
  font-size: 11px !important;
  line-height: 1 !important;
  margin-top: 8px !important;
  font-weight: 400 !important;
  color: var(--noobot-text-secondary, var(--el-text-color-secondary));
  letter-spacing: 0.5px;
}

/* --- 状态样式定制 --- */

/* 已完成的节点 */
.message-status-steps :deep(.el-step__head.is-success .el-step__icon),
.message-status-steps :deep(.el-step__head.is-finish .el-step__icon) {
  background-color: var(--el-text-color-placeholder);
}
.message-status-steps :deep(.el-step__title.is-success),
.message-status-steps :deep(.el-step__title.is-finish) {
  color: var(--el-text-color-regular);
}

/* 当前进行中的节点 (高亮 + 荧光呼吸) */
.message-status-steps :deep(.el-step__head.is-process .el-step__icon) {
  background-color: var(--el-color-primary);
  box-shadow: 0 0 8px 1px color-mix(in srgb, var(--el-color-primary) 60%, transparent);
  transform: scale(1.2);
}
.message-status-steps.is-running :deep(.el-step__head.is-process .el-step__icon) {
  animation: dot-glow 1.5s ease-in-out infinite alternate;
}
.message-status-steps :deep(.el-step__title.is-process) {
  color: var(--el-color-primary);
  font-weight: 600 !important;
}

/* 错误与警告状态 */
.message-status-steps.is-error :deep(.el-step__head.is-error .el-step__icon) {
  background-color: var(--el-color-danger);
  box-shadow: 0 0 6px var(--el-color-danger-light-5);
}
.message-status-steps.is-error :deep(.el-step__title.is-error) {
  color: var(--el-color-danger);
}

.message-status-steps.is-warning :deep(.el-step__head.is-warning .el-step__icon) {
  background-color: var(--el-color-warning);
  box-shadow: 0 0 6px var(--el-color-warning-light-5);
}
.message-status-steps.is-warning :deep(.el-step__title.is-warning) {
  color: var(--el-color-warning);
}

/* 呼吸灯动画 */
@keyframes dot-glow {
  0% {
    box-shadow: 0 0 2px 0px color-mix(in srgb, var(--el-color-primary) 40%, transparent);
  }
  100% {
    box-shadow: 0 0 8px 2px color-mix(in srgb, var(--el-color-primary) 80%, transparent);
  }
}

/* 移动端微调 */
@media (max-width: 560px) {
  .message-status-steps {
    min-width: 100%;
    padding: 10px 16px 6px;
    border-radius: 12px; /* 移动端屏幕窄，改回小圆角 */
  }
  .message-status-steps :deep(.el-step__title) {
    font-size: 10px !important;
    transform: scale(0.9);
  }
}
</style>