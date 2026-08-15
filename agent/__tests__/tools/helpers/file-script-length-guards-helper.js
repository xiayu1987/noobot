/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileTool } from "../../../src/tools/execution/file-tool.js";
import { executeToolCall } from "../../../src/runtime/tool-execution/tool-runner.js";
import { transferSemanticContent } from "../../../src/transfer-adapter/index.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  buildExecutionWorkspaceMeta,
  buildScriptExecutionMeta,
  createScriptTool,
} from "../../../src/tools/execution/script-tool.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

function buildAgentContext(basePath = "", userId = "u-test", overrides = {}) {
  const runtimeOverrides =
    overrides?.runtime && typeof overrides.runtime === "object" ? overrides.runtime : {};
  const sharedTools =
    runtimeOverrides?.sharedTools && typeof runtimeOverrides.sharedTools === "object"
      ? runtimeOverrides.sharedTools
      : {};
  return createTestAgentExecutionScope(
    {
      basePath,
      userId,
      globalConfig: {
        security: {
          executionIsolation: {
            mode: "host",
            sandbox: { provider: "docker", scope: "user" },
          },
        },
      },
      userConfig: {},
      systemRuntime: {
        userId,
        sessionId: "s-1",
        rootSessionId: "s-1",
        config: {},
      },
      sharedTools,
      ...runtimeOverrides,
    },
    { identity: { userId } },
  );
}

function parseToolResult(raw = "") {
  return JSON.parse(String(raw || "{}"));
}

function buildAttachmentService() {
  return {
    async ingestGeneratedArtifacts(payload = {}) {
      return (Array.isArray(payload.artifacts) ? payload.artifacts : []).map(
        (artifact = {}, index) => ({
          attachmentId: `att-tool-input-${index + 1}`,
          sessionId: payload.sessionId,
          attachmentSource: payload.attachmentSource,
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: Buffer.from(String(artifact.contentBase64 || ""), "base64").length,
          path: `/host/${artifact.name}`,
          relativePath: `runtime/attach/${artifact.name}`,
          generatedByModel: true,
          generationSource: payload.generationSource,
        }),
      );
    },
  };
}

export {
  test,
  assert,
  fs,
  os,
  path,
  createFileTool,
  executeToolCall,
  transferSemanticContent,
  LENGTH_THRESHOLDS,
  buildExecutionWorkspaceMeta,
  buildScriptExecutionMeta,
  createScriptTool,
  buildAgentContext,
  parseToolResult,
  buildAttachmentService,
};
