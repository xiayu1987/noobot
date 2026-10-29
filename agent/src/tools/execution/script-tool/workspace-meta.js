/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import {
  assertToolExecutionPolicy,
  projectToolExecutionMeta,
} from "@noobot/execution-isolation-protocol";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { persistTransferArtifacts } from "../../../transfer-adapter/index.js";
import { EXECUTE_SCRIPT_TOOL_NAME, SCRIPT_EXECUTION_MODE } from "./constants.js";
import { buildOutputTransferDeclaration } from "./output-transfer-declaration.js";
import { text, isObjectLike } from "@noobot/shared/value";

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {}).filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0;
      if (isObjectLike(item)) return Object.keys(item).length > 0;
      return item !== undefined && item !== null && text(item) !== "";
    }),
  );
}

export function buildExecutionWorkspaceMeta({ executionPolicy = {} } = {}) {
  assertToolExecutionPolicy(executionPolicy);
  return {
    view: "workspace",
    path: ".",
  };
}

function buildExecutionMeta({ executionPolicy = {} } = {}) {
  return compactObject(projectToolExecutionMeta({ policy: executionPolicy }));
}

export function buildScriptExecutionMeta({ executionPolicy = {} } = {}) {
  return compactObject({
    execution: buildExecutionMeta({ executionPolicy }),
    workspace: buildExecutionWorkspaceMeta({ executionPolicy }),
  });
}

async function buildBackgroundOutputArtifact({ filePath = "", name = "", role = "" } = {}) {
  const bytes = await readFile(filePath).catch(() => Buffer.alloc(0));
  if (!bytes.length) return null;
  return {
    name,
    mimeType: "text/plain",
    contentBase64: bytes.toString("base64"),
    meta: { role },
  };
}

async function persistBackgroundScriptOutput({ runtime = {}, result = {}, identity = null } = {}) {
  const artifacts = [
    await buildBackgroundOutputArtifact({
      filePath: result.stdoutPath,
      name: "execute-script-stdout.txt",
      role: "stdout",
    }),
    await buildBackgroundOutputArtifact({
      filePath: result.stderrPath,
      name: "execute-script-stderr.txt",
      role: "stderr",
    }),
  ].filter(Boolean);
  if (!artifacts.length) return null;
  return persistTransferArtifacts({
    runtime,
    artifacts,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: TRANSFER_REASON.EXECUTE_SCRIPT_BACKGROUND,
    source: "tool",
    reason: TRANSFER_REASON.EXECUTE_SCRIPT_BACKGROUND,
    identity,
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.EXECUTE_SCRIPT_BACKGROUND,
      scenario: "tool",
      strategy: "tool_output",
    },
    meta: { contentOmitted: true },
  });
}

export async function toolFileBackedExecResult(mode, r = {}, extra = {}, options = {}) {
  const { runtime } = options;
  const persisted = await persistBackgroundScriptOutput({
    runtime,
    result: r,
    identity: options?.identity,
  });
  const transferEnvelopes = [
    ...(persisted?.transferEnvelopes || []),
    ...(Array.isArray(options?.outputFileEnvelopes) ? options.outputFileEnvelopes : []),
  ];
  return toToolJsonResult(EXECUTE_SCRIPT_TOOL_NAME, {
    ok: Number(r?.code || 0) === 0,
    mode,
    executionMode: SCRIPT_EXECUTION_MODE.BACKGROUND,
    ...extra,
    code: Number(r?.code || 0),
    ...buildOutputTransferDeclaration({
      reason: TRANSFER_REASON.EXECUTE_SCRIPT_BACKGROUND,
      transferEnvelopes,
      outputLimitExceeded: r?.outputLimitExceeded === true,
      outputLimitBytes: Number(r?.outputLimitBytes || 0),
    }),
    ...(r?.outputLimitExceeded === true
      ? {
          outputLimitExceeded: true,
          outputLimitBytes: Number(r?.outputLimitBytes || 0),
        }
      : {}),
    ...(r?.signal ? { signal: r.signal } : {}),
  });
}
