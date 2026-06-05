import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDoc2DataTool } from "../../../src/system-core/tools/data-processing/doc2data-tool.js";
import { createMedia2DataTool } from "../../../src/system-core/tools/data-processing/media2data-tool.js";
import { createContentProcessTool } from "../../../src/system-core/tools/data-processing/content-process-tool.js";
import { createWeb2DataTool } from "../../../src/system-core/tools/data-processing/web2data-tool.js";
import { createConnectorAccessTool } from "../../../src/system-core/tools/connectors/connector-access-tool.js";
import { ERROR_CODE } from "../../../src/system-core/error/constants.js";
import { TOOL_NAME } from "../../../src/system-core/tools/constants/index.js";

function buildAgentContext(basePath = "") {
  return {
    environment: {
      workspace: { basePath },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          globalConfig: {},
          userConfig: {},
          sharedTools: {},
        },
      },
    },
  };
}

test("doc_to_data: image input should fail fast with unsupported file type", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-doc2data-"));
  const imagePath = path.join(basePath, "runtime", "ops_workdir", "input.png");
  await fs.mkdir(path.dirname(imagePath), { recursive: true });
  await fs.writeFile(imagePath, "not-a-real-png", "utf8");

  const tools = createDoc2DataTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === TOOL_NAME.DOC_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ filePath: "runtime/ops_workdir/input.png" }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_UNSUPPORTED_FILE_TYPE,
  );
});

test("media_to_data: non-media file should fail with unsupported media file type", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-media2data-"));
  const textPath = path.join(basePath, "runtime", "ops_workdir", "input.txt");
  await fs.mkdir(path.dirname(textPath), { recursive: true });
  await fs.writeFile(textPath, "plain text", "utf8");

  const tools = createMedia2DataTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === TOOL_NAME.MEDIA_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ filePath: "runtime/ops_workdir/input.txt" }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_UNSUPPORTED_MEDIA_FILE_TYPE,
  );
});

test("web_to_data: empty input and urls should fail before network work", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-web2data-"));
  const tools = createWeb2DataTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === TOOL_NAME.WEB_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ input: "", urls: [] }),
    (error) =>
      error?.code === ERROR_CODE.RECOVERABLE_WEB_TO_DATA_FAILED &&
      Array.isArray(error?.details?.urls) &&
      error.details.urls.length === 0,
  );
});

test("process_content_task: detached runtime uses durable parent session", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-process-content-"));
  const calls = [];
  const botManager = {
    async runSession(payload = {}) {
      calls.push(payload);
      return {
        sessionId: payload.sessionId,
        answer: "ok",
        traces: [],
        messages: [],
      };
    },
  };
  const tools = createContentProcessTool({
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            basePath,
            userId: "admin",
            globalConfig: {},
            userConfig: {},
            botManager,
            sharedTools: {},
            systemRuntime: {
              sessionId: "detached-node-session",
              childRunParentSessionId: "root-workflow-session",
              config: {},
            },
          },
        },
      },
    },
  });
  const tool = tools.find((item) => item?.name === TOOL_NAME.PROCESS_CONTENT_TASK);
  assert.ok(tool);

  const resultText = await tool.invoke({
    task: "parse content",
    contentPath: "runtime/attach/file.png",
  });
  const result = JSON.parse(resultText);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.parentSessionId, "root-workflow-session");
  assert.equal(calls[0]?.sessionId, result.sessionId);
  assert.equal(result.parentSessionId, "root-workflow-session");
});

test("process_connector_tool: detached runtime uses durable parent session", async () => {
  const calls = [];
  const botManager = {
    async runSession(payload = {}) {
      calls.push(payload);
      return {
        sessionId: payload.sessionId,
        answer: "ok",
        traces: [],
        messages: [],
      };
    },
  };
  const tools = createConnectorAccessTool({
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            globalConfig: {},
            userConfig: {},
            botManager,
            sharedTools: {
              connectorChannelStore: {
                getSessionConnectors() {
                  return { databases: [], terminals: [], emails: [] };
                },
              },
            },
            systemRuntime: {
              sessionId: "detached-node-session",
              childRunParentSessionId: "root-workflow-session",
              config: {},
            },
          },
        },
      },
    },
  });
  const tool = tools.find((item) => item?.name === TOOL_NAME.PROCESS_CONNECTOR_TOOL);
  assert.ok(tool);

  const resultText = await tool.invoke({ task: "inspect connector" });
  const result = JSON.parse(resultText);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.parentSessionId, "root-workflow-session");
  assert.equal(result.parentSessionId, "root-workflow-session");
});
