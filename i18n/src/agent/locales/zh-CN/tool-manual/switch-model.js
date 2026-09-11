/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SWITCH_MODEL_MANUAL = {
  switch_model: {
    summary: "切换当前会话使用的模型。",
    usage: ["switch_model({ modelName })"],
    params: {
      modelName: "目标模型名，必须是配置中已声明且提供方已启用的模型。",
    },
    notes: [
      "用于任务性质变化时改用更合适的模型，例如从长文推理切到轻量快速响应。",
      "可用模型集合由 providers 配置决定，未配置的模型名会报错。",
    ],
    pitfalls: ["切换只影响后续调用，不会重放已完成的推理。"],
  },
};
