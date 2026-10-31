/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import { formatLinesWithNumbers, splitLines } from "../file-utils.js";
import { EXECUTE_SCRIPT_TOOL_NAME } from "./constants.js";
import { buildOutputTransferDeclaration } from "./output-transfer-declaration.js";
import { persistTransferArtifacts } from "../../../transfer-adapter/index.js";
import { readFile } from "node:fs/promises";

function formatCommandOutputWithLineNumbers(output) {
  if (!output) return "";
  const lines = splitLines(output);
  if (output.endsWith("\n")) lines.pop();
  return formatLinesWithNumbers(lines, 1);
}

function normalizeExecOutput(result, includeLineNumbers) {
  if (!includeLineNumbers) return result;
  return {
    ...result,
    stdout: formatCommandOutputWithLineNumbers(result.stdout),
    stderr: formatCommandOutputWithLineNumbers(result.stderr),
  };
}

export async function toolExecResult(mode, r, extra, options) {
  const { runtime, identity, outputFileEnvelopes, outputResources } = options;
  const includeLineNumbers = options.includeLineNumbers === true;
  const {
    stdoutPath: _stdoutPath,
    stderrPath: _stderrPath,
    stdoutBytes: _stdoutBytes,
    stderrBytes: _stderrBytes,
    outputOverflow: _outputOverflow,
    ...publicResult
  } = r;
  const normalizedResult = normalizeExecOutput(publicResult, includeLineNumbers);
  const overflowFiles =
    r.outputOverflow === true
      ? [
          { role: "stdout", filePath: r.stdoutPath, bytes: r.stdoutBytes },
          { role: "stderr", filePath: r.stderrPath, bytes: r.stderrBytes },
        ].filter((item) => item.bytes > 0)
      : [];
  let transferEnvelopes = [];
  if (overflowFiles.length) {
    if (!identity) throw new Error("semantic_transfer_script_identity_required");
    const artifacts = await Promise.all(
      overflowFiles.map(async (item) => ({
        name: `execute-script-${item.role}.txt`,
        mimeType: "text/plain",
        contentBase64: (await readFile(item.filePath)).toString("base64"),
        meta: { role: item.role },
      })),
    );
    const persisted = await persistTransferArtifacts({
      runtime,
      artifacts,
      attachmentSource: ATTACHMENT_SOURCE.MODEL,
      generationSource: TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_OVERFLOW,
      source: "tool",
      reason: TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_OVERFLOW,
      identity,
      intent: {
        source: "tool",
        reason: TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_OVERFLOW,
        scenario: "tool",
        strategy: "tool_output",
      },
      meta: { contentOmitted: true },
    });
    transferEnvelopes = persisted.transferEnvelopes;
  }
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    mode,
    ...extra,
    ...normalizedResult,
    ...(r.outputOverflow === true
      ? {
          ...buildOutputTransferDeclaration({
            reason: TRANSFER_REASON.EXECUTE_SCRIPT_OUTPUT_OVERFLOW,
            transferEnvelopes: [...transferEnvelopes, ...outputFileEnvelopes],
            outputLimitExceeded: r.outputLimitExceeded === true,
            outputLimitBytes: r.outputLimitBytes,
          }),
        }
      : outputFileEnvelopes.length
        ? { transferEnvelopes: outputFileEnvelopes }
        : {}),
    ...(outputResources.length ? { outputResources } : {}),
    includeLineNumbers,
  });
}
