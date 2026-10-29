/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSourcePath } from "@noobot/attachment-protocol";
import { ERROR_CODE } from "../../src/shared/errors/constants.js";
import {
  test,
  assert,
  fs,
  os,
  path,
  createScriptTool,
  buildAgentContext,
  parseToolResult,
  buildAttachmentService,
} from "./helpers/file-script-length-guards-helper.js";

const TEST_TRANSFER_IDENTITY = Object.freeze({
  transferId: "transfer:test:execute-script:output-files",
  presentationMessageId: "message:test-output-files",
  sessionId: "session:test-output-files",
  turnScopeId: "turn:test-output-files",
  runId: "run:test-output-files",
  producer: { type: "tool", id: "call:test-output-files" },
});

function buildHostTool(basePath, attachmentService) {
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: { security: { executionIsolation: { mode: "host" } } },
        attachmentService,
        systemRuntime: { config: { safeConfirm: false }, isSuperUser: true },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);
  return tool;
}

function buildCapturingAttachmentService() {
  const captured = [];
  const base = buildAttachmentService();
  return {
    captured,
    service: {
      async ingestGeneratedArtifacts(payload = {}) {
        captured.push(...(Array.isArray(payload.artifacts) ? payload.artifacts : []));
        return base.ingestGeneratedArtifacts(payload);
      },
    },
  };
}

function invokeScript(tool, args) {
  return tool.invoke(args, { configurable: { transferIdentity: TEST_TRANSFER_IDENTITY } });
}

test("execute_script: outputFiles 登记为附件并写入规范化 sourcePath", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-output-files-"));
  const { captured, service } = buildCapturingAttachmentService();
  const tool = buildHostTool(basePath, service);
  const filePath = path.join(basePath, "report.xlsx");

  const result = parseToolResult(
    await invokeScript(tool, {
      command: `printf 'data' > "${filePath}"`,
      riskLevel: "low",
      outputFiles: [filePath],
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.transferEnvelopes), true);
  assert.ok(result.transferEnvelopes.length >= 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].name, "report.xlsx");
  assert.equal(captured[0].sourcePath, normalizeSourcePath(filePath));
  assert.equal(Buffer.from(captured[0].contentBase64, "base64").toString(), "data");
});

test("execute_script: outputFiles 声明不存在的文件时明确失败且不登记", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-output-missing-"));
  const { captured, service } = buildCapturingAttachmentService();
  const tool = buildHostTool(basePath, service);
  const missingPath = path.join(basePath, "never-created.xlsx");

  await assert.rejects(
    () =>
      invokeScript(tool, {
        command: "printf 'ok'",
        riskLevel: "low",
        outputFiles: [missingPath],
      }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_FILE_NOT_FOUND,
  );
  assert.equal(captured.length, 0);
});

test("execute_script: outputFiles 单文件超出附件策略时明确失败且不登记", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-output-limit-"));
  const { captured, service } = buildCapturingAttachmentService();
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: {
          security: { executionIsolation: { mode: "host" } },
          attachments: { maxFileSizeBytes: 1 },
        },
        attachmentService: service,
        systemRuntime: { config: { safeConfirm: false }, isSuperUser: true },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);
  const filePath = path.join(basePath, "big.xlsx");

  await assert.rejects(
    () =>
      invokeScript(tool, {
        command: `printf 'abcdef' > "${filePath}"`,
        riskLevel: "low",
        outputFiles: [filePath],
      }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED,
  );
  assert.equal(captured.length, 0);
});

test("execute_script: 非超管 host 路径 outputFiles 被拒且不登记", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-output-deny-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-output-outside-"));
  const outsideFile = path.join(outside, "secret.xlsx");
  await fs.writeFile(outsideFile, "secret");
  const { captured, service } = buildCapturingAttachmentService();
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "regular-user", {
      runtime: {
        globalConfig: { security: { executionIsolation: { mode: "sandbox" } } },
        attachmentService: service,
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  await assert.rejects(
    () => invokeScript(tool, { command: "true", riskLevel: "low", outputFiles: [outsideFile] }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
  );
  assert.equal(captured.length, 0);
});

test("execute_script: 越权 outputFiles 在命令执行前被拒，命令不产生副作用", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-output-preflight-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-output-preflight-out-"));
  const marker = path.join(basePath, "command-ran.marker");
  const { captured, service } = buildCapturingAttachmentService();
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "regular-user", {
      runtime: {
        globalConfig: { security: { executionIsolation: { mode: "sandbox" } } },
        attachmentService: service,
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  await assert.rejects(
    () =>
      invokeScript(tool, {
        command: `touch "${marker}"`,
        riskLevel: "low",
        outputFiles: [path.join(outside, "secret.xlsx")],
      }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_PATH_OUT_OF_SCOPE,
  );
  await assert.rejects(() => fs.access(marker));
  assert.equal(captured.length, 0);
});
