/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

export async function appendParseErrorLog({
  storage,
  basePath = "",
  stage = "",
  rawContent = "",
  candidate = "",
  error = "",
  } = {}) {
  try {
    if (!basePath) return;
    const lessonsDir = storage.summaryPipelineDir(basePath);
    await storage.ensureDir(lessonsDir);
    const logPath = path.join(lessonsDir, "_parse-error.log");
    const rawText =
      typeof rawContent === "string"
        ? rawContent
        : JSON.stringify(rawContent ?? "", null, 2);
    const block = [
      `[${new Date().toISOString()}] stage=${String(stage || "").trim() || "unknown"}`,
      `error=${String(error || "").trim() || "unknown_parse_error"}`,
      `candidate=${String(candidate || "").slice(0, 2000)}`,
      "raw:",
      String(rawText || "").slice(0, 20000),
      "---",
      "",
    ].join("\n");
    await storage.appendText(logPath, block);
  } catch {
    // 调试日志写入失败不影响主流程
  }
}
