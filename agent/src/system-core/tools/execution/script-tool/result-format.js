/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { formatLinesWithNumbers, splitLines } from "../file-utils.js";
import { EXECUTE_SCRIPT_TOOL_NAME } from "./constants.js";
import {
  TRANSFER_DIRECTION,
  TRANSFER_STORAGE_KIND,
  TRANSFER_TRANSPORT,
  buildTransferFileEntry,
  createTransferEnvelope,
} from "../../../semantic-transfer/index.js";
import { filePath as path } from "../../../utils/path-resolver.js";

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

export function toolExecResult(mode, r = {}, extra = {}, options = {}) {
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
  const basePath = String(options?.basePath || "").trim();
  const overflowFiles = r?.outputOverflow === true
    ? [
        { role: "stdout", filePath: r.stdoutPath, bytes: r.stdoutBytes },
        { role: "stderr", filePath: r.stderrPath, bytes: r.stderrBytes },
      ].filter((item) => Number(item.bytes || 0) > 0)
    : [];
  const transferFiles = overflowFiles.map((item, index) => buildTransferFileEntry({
    runtime,
    agentContext,
    hostPath: item.filePath,
    relativePath: basePath && item.filePath.startsWith(basePath)
      ? path.relative(basePath, item.filePath).split(path.sep).join("/")
      : "",
    meta: {
      name: `execute-script-${item.role}.txt`,
      mimeType: "text/plain",
      size: item.bytes,
      isSandbox: extra?.workspace?.view === "sandbox",
    },
    purpose: "execute_script_output_overflow",
    role: index === 0 ? "primary" : "secondary",
  }));
  const transferEnvelopes = transferFiles.length ? [createTransferEnvelope({
    direction: TRANSFER_DIRECTION.OUTPUT,
    transport: TRANSFER_TRANSPORT.FILE,
    files: transferFiles,
    storage: { kind: TRANSFER_STORAGE_KIND.WORKSPACE, originalFile: true, persisted: false },
    producer: { type: "tool", name: EXECUTE_SCRIPT_TOOL_NAME },
    meta: { reason: "execute_script_output_overflow", contentOmitted: true },
  })] : [];
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    ...extra,
    ...normalizedResult,
    ...(r?.outputOverflow === true ? {
      message: "Command output exceeded the inline limit; full stdout/stderr remain available through the returned file references.",
      outputOverflow: true,
      outputFiles: Object.fromEntries(transferFiles.map((file, index) => [overflowFiles[index].role, {
        filePath: file.filePath,
        bytes: overflowFiles[index].bytes,
      }])),
      transferEnvelopes,
    } : {}),
    includeLineNumbers,
  });
}
