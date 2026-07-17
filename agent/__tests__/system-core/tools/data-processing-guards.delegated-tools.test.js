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
import {
  createDoc2DataTool,
  decodeLibreOfficeTextBuffer,
} from "../../../src/system-core/tools/data-processing/doc2data-tool.js";
import {
  buildLibreOfficeTempPathTokensForNodePid,
  resolveLibreOfficeTempRoots,
} from "../../../src/system-core/tools/data-processing/doc2data/libreoffice.js";
import {
  createMedia2DataTool,
  resolveMediaBinaryPath,
  runMediaProcess,
} from "../../../src/system-core/tools/data-processing/media2data-tool.js";
import { createContentProcessTool } from "../../../src/system-core/tools/data-processing/content-process-tool.js";
import { createWeb2DataTool } from "../../../src/system-core/tools/data-processing/web2data-tool.js";
import { createConnectorAccessTool } from "../../../src/system-core/tools/connectors/connector-access-tool.js";
import { ERROR_CODE } from "../../../src/system-core/error/constants.js";
import { TOOL_NAME } from "../../../src/system-core/tools/constants/index.js";
import { buildAgentContext } from "./data-processing-guards.test-helpers.js";


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
            userId: "primary-user",
            globalConfig: {},
            userConfig: {},
            botManager,
            sharedTools: {},
            systemRuntime: {
              sessionId: "detached-node-session",
              childRunParentSessionId: "root-plugin-session",
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
  assert.equal(calls[0]?.parentSessionId, "root-plugin-session");
  assert.equal(calls[0]?.sessionId, result.sessionId);
  assert.equal(result.parentSessionId, "root-plugin-session");
});

test("process_content_task: 透传父 runConfig 显式 streaming=false 到子 session", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-process-content-streaming-"));
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
            userId: "primary-user",
            globalConfig: {},
            userConfig: {},
            botManager,
            sharedTools: {},
            systemRuntime: {
              sessionId: "parent-session",
              config: {
                streaming: false,
              },
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

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.runConfig?.streaming, false);
});

test("process_content_task: 缺省 modelName 时继承父运行时模型", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-process-content-model-"));
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
            userId: "primary-user",
            runtimeModel: "gpt_5_6",
            globalConfig: {},
            userConfig: {},
            botManager,
            sharedTools: {},
            systemRuntime: {
              sessionId: "parent-session",
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

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.runConfig?.runtimeModel, "gpt_5_6");
});

test("process_content_task: 显式 modelName 优先于父运行时模型", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-process-content-model-priority-"));
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
            userId: "primary-user",
            runtimeModel: "gpt_5_6",
            globalConfig: {},
            userConfig: {},
            botManager,
            sharedTools: {},
            systemRuntime: {
              sessionId: "parent-session",
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
    modelName: "custom-model",
  });
  const result = JSON.parse(resultText);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.runConfig?.runtimeModel, "custom-model");
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
            userId: "primary-user",
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
              childRunParentSessionId: "root-plugin-session",
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
  assert.equal(calls[0]?.parentSessionId, "root-plugin-session");
  assert.equal(
    String(calls[0]?.systemMessages?.[0] || ""),
    "可处理连接器相关任务（数据库/终端/邮箱）。连接信息由系统连接器自动处理，无需提供或询问连接信息",
  );
  assert.equal(result.parentSessionId, "root-plugin-session");
});

test("process_connector_tool: 透传父 runConfig 显式 streaming=false 到子 session", async () => {
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
            userId: "primary-user",
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
              sessionId: "parent-session",
              config: {
                streaming: false,
              },
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

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.runConfig?.streaming, false);
});
