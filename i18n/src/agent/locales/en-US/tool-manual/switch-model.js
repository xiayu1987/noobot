/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SWITCH_MODEL_MANUAL = {
  switch_model: {
    summary: "Switch the model used by the current session.",
    usage: ["switch_model({ modelName })"],
    params: {
      modelName:
        "Target model name. Must be declared in configuration with its provider enabled.",
    },
    notes: [
      "Use it when the nature of the task changes, for example moving from long-form reasoning to fast lightweight replies.",
      "The available set comes from the providers configuration; an unconfigured name fails.",
    ],
    pitfalls: ["Switching affects later calls only; it does not replay reasoning already done."],
  },
};
