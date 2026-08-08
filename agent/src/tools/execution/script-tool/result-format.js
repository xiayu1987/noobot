/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { formatLinesWithNumbers, splitLines } from "../file-utils.js";
import { EXECUTE_SCRIPT_TOOL_NAME } from "./constants.js";
import {
  getTransferAttachments,
  persistTransferArtifacts,
} from "../../../transfer-adapter/index.js";
import { readFile } from "node:fs/promises";

export function formatCommandOutputWithLineNumbers(value = "") {
  const text = String(value || "");
  if (!text) return "";
  const lines = splitLines(text);
  if (text.endsWith("\n")) lines.pop();
  return formatLinesWithNumbers(lines, 1);
}

export function normalizeExecOutput(r = {}, { includeLineNumbers = false } = {}) {
  if (includeLineNumbers !== true) return r;
  return {
    ...r,
    stdout: formatCommandOutputWithLineNumbers(r?.stdout || ""),
    stderr: formatCommandOutputWithLineNumbers(r?.stderr || ""),
  };
}

export async function toolExecResult(mode, r = {}, extra = {}, options = {}) {
  const includeLineNumbers = options?.includeLineNumbers === true;
  const {
    stdoutPath: _stdoutPath,
    stderrPath: _stderrPath,
    stdoutBytes: _stdoutBytes,
    stderrBytes: _stderrBytes,
    outputOverflow: _outputOverflow,
    ...publicResult
  } = r || {};
  const normalizedResult = normalizeExecOutput(publicResult, { includeLineNumbers });
  const runtime = options?.runtime || {};
  const agentContext = options?.agentContext || null;
  const overflowFiles = r?.outputOverflow === true
    ? [
        { role: "stdout", filePath: r.stdoutPath, bytes: r.stdoutBytes },
        { role: "stderr", filePath: r.stderrPath, bytes: r.stderrBytes },
      ].filter((item) => Number(item.bytes || 0) > 0)
    : [];
  let transferEnvelopes = [];
  if (overflowFiles.length) {
    if (!options?.identity) throw new Error("semantic_transfer_script_identity_required");
    const artifacts = await Promise.all(overflowFiles.map(async (item) => ({
      name: `execute-script-${item.role}.txt`,
      mimeType: "text/plain",
      contentBase64: (await readFile(item.filePath)).toString("base64"),
      meta: { role: item.role },
    })));
    const persisted = await persistTransferArtifacts({
      runtime,
      agentContext,
      userId: String(runtime?.userId || runtime?.systemRuntime?.userId || "").trim(),
      artifacts,
      attachmentSource: "model",
      generationSource: "execute_script_output_overflow",
      source: "tool",
      reason: "execute_script_output_overflow",
      identity: options.identity,
      intent: {
        source: "tool",
        reason: "execute_script_output_overflow",
        scenario: "tool",
        strategy: "execute_script_output_overflow",
      },
      meta: { contentOmitted: true },
    });
    transferEnvelopes = persisted.transferEnvelopes;
  }
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    ...extra,
    ...normalizedResult,
    ...(r?.outputOverflow === true ? {
      message: "Command output exceeded the inline limit; full stdout/stderr remain available through the returned file references.",
      outputOverflow: true,
      transferEnvelopes,
      attachments: getTransferAttachments(transferEnvelopes),
    } : {}),
    includeLineNumbers,
  });
}
