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
/* 与思考过程面板共用同一套卡片语言，仅以状态色区分运行结果。 */
.message-status-steps {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin: 0 0 var(--noobot-space-md);
  padding: 12px var(--noobot-space-md) 10px;
  border: 1px solid color-mix(in srgb, var(--noobot-panel-border) 72%, transparent);
  border-radius: var(--noobot-radius-xs);
  color: var(--noobot-text-secondary);
  background: var(--noobot-thinking-bg);
  overflow: hidden;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.message-status-steps.is-running {
  border-color: color-mix(in srgb, var(--el-color-primary) 55%, var(--noobot-panel-border));
  background: color-mix(in srgb, var(--el-color-primary) 10%, var(--noobot-thinking-bg));
  box-shadow: 0 4px 16px color-mix(in srgb, var(--el-color-primary) 16%, transparent);
  animation: running-card-glow 2.4s ease-in-out infinite;
}
.message-status-steps.is-error {
  border-color: color-mix(in srgb, var(--noobot-status-error) 32%, var(--noobot-panel-border));
  background: color-mix(in srgb, var(--noobot-status-error) 5%, var(--noobot-thinking-bg));
}
.message-status-steps.is-warning {
  border-color: color-mix(in srgb, var(--noobot-status-warning) 32%, var(--noobot-panel-border));
  background: color-mix(in srgb, var(--noobot-status-warning) 5%, var(--noobot-thinking-bg));
}

/* 2. 隐藏默认的粗糙元素，重塑节点为“微型圆点” */
.message-status-steps :deep(.el-step__icon) {
  width: 6px !important;
  height: 6px !important;
  border: none !important;
  border-radius: 50%;
  background-color: var(--noobot-panel-border);
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
  background-color: var(--noobot-divider);
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
  color: var(--noobot-thinking-muted);
  letter-spacing: 0.5px;
}

/* --- 状态样式定制 --- */

/* 已完成的节点 */
.message-status-steps :deep(.el-step__head.is-success .el-step__icon),
.message-status-steps :deep(.el-step__head.is-finish .el-step__icon) {
  background-color: var(--noobot-text-muted);
}
.message-status-steps :deep(.el-step__title.is-success),
.message-status-steps :deep(.el-step__title.is-finish) {
  color: var(--noobot-text-secondary);
}

/* 当前进行中的节点 (高亮 + 荧光呼吸) */
.message-status-steps :deep(.el-step__head.is-process .el-step__icon) {
  background-color: var(--el-color-primary);
  box-shadow: 0 0 8px 1px color-mix(in srgb, var(--el-color-primary) 60%, transparent);
  transform: scale(1.2);
}
.message-status-steps.is-running :deep(.el-step__head.is-process .el-step__icon) {
  width: 8px !important;
  height: 8px !important;
  animation: dot-glow 1.25s ease-in-out infinite alternate;
}
.message-status-steps :deep(.el-step__title.is-process) {
  color: var(--el-color-primary);
  font-weight: 600 !important;
}
.message-status-steps.is-running :deep(.el-step__title.is-process) {
  letter-spacing: 0.65px;
  text-shadow: 0 0 12px color-mix(in srgb, var(--el-color-primary) 36%, transparent);
}

/* 错误与警告状态 */
.message-status-steps.is-error :deep(.el-step__head.is-error .el-step__icon) {
  background-color: var(--noobot-status-error);
  box-shadow: 0 0 6px color-mix(in srgb, var(--noobot-status-error) 45%, transparent);
}
.message-status-steps.is-error :deep(.el-step__title.is-error) {
  color: var(--noobot-status-error);
}

.message-status-steps.is-warning :deep(.el-step__head.is-warning .el-step__icon) {
  background-color: var(--noobot-status-warning);
  box-shadow: 0 0 6px color-mix(in srgb, var(--noobot-status-warning) 45%, transparent);
}
.message-status-steps.is-warning :deep(.el-step__title.is-warning) {
  color: var(--noobot-status-warning);
}

/* 呼吸灯动画 */
@keyframes dot-glow {
  0% {
    box-shadow: 0 0 3px 0 color-mix(in srgb, var(--el-color-primary) 50%, transparent);
    transform: scale(1.15);
  }
  100% {
    box-shadow: 0 0 12px 4px color-mix(in srgb, var(--el-color-primary) 80%, transparent);
    transform: scale(1.42);
  }
}

@keyframes running-card-glow {
  0%, 100% {
    border-color: color-mix(in srgb, var(--el-color-primary) 48%, var(--noobot-panel-border));
  }
  50% {
    border-color: color-mix(in srgb, var(--el-color-primary) 72%, var(--noobot-panel-border));
  }
}

@media (prefers-reduced-motion: reduce) {
  .message-status-steps.is-running,
  .message-status-steps.is-running :deep(.el-step__head.is-process .el-step__icon) {
    animation: none;
  }
}

/* 移动端微调 */
@media (max-width: 560px) {
  .message-status-steps {
    padding: 10px var(--noobot-space-md) 8px;
  }
  .message-status-steps :deep(.el-step__title) {
    font-size: 10px !important;
    transform: scale(0.9);
  }
}
</style>