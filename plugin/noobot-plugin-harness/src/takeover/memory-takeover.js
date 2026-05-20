/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function memoryTakeoverHandler(ctx, directive) {
  const key = directive?.key || directive?.name;
  const value = directive?.value;
  if (!key) return { applied: false, reason: "No memory key specified" };
  const memory = ctx.memory || ctx.agentContext?.memory || {};
  memory[key] = value;
  return { applied: true, action: "set", key };
}
