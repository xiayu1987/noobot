/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function messageTakeoverHandler(ctx, directive) {
  const messages = Array.isArray(ctx.messages) ? ctx.messages : [];
  const content = directive?.content || directive?.text;
  if (!content) return { applied: false, reason: "No content specified" };
  messages.push({ role: directive.role || "system", content });
  return { applied: true, action: "inject", messageCount: messages.length };
}
