import test from "node:test";
import assert from "node:assert/strict";

import { createUserInteractionTool } from "../../../src/system-core/tools/collaboration/user-interaction-tool.js";

function parseToolJson(raw = "") {
  return JSON.parse(String(raw || "{}"));
}

test("user_interaction: should forward lifecycle/ackMode defaults to bridge", async () => {
  const calls = [];
  const tools = createUserInteractionTool({
    agentContext: {
      runtime: {
        userInteractionBridge: {
          async requestUserInteraction(payload = {}) {
            calls.push(payload);
            return {
              confirmTest: "yes",
              response: "ok",
            };
          },
        },
        systemRuntime: {
          dialogProcessId: "dp-1",
          sessionId: "s-1",
        },
      },
    },
  });

  const tool = tools.find((item) => item?.name === "user_interaction");
  assert.ok(tool, "user_interaction tool should exist");

  const result = parseToolJson(
    await tool.invoke({
      content: "please confirm",
      fields: {
        fields: [
          {
            name: "confirmTest",
            displayName: "确认",
            required: true,
            description: "",
          },
        ],
      },
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0]?.lifecycle || ""), "pending");
  assert.equal(String(calls[0]?.ackMode || ""), "manual");
  assert.equal(String(calls[0]?.resolvedBy || ""), "");
});

test("user_interaction: should tolerate unescaped quotes inside fields string descriptions", async () => {
  const calls = [];
  const tools = createUserInteractionTool({
    agentContext: {
      runtime: {
        userInteractionBridge: {
          async requestUserInteraction(payload = {}) {
            calls.push(payload);
            return {
              contentPath: "/workspace/primary-user/input.pdf",
              response: "ok",
            };
          },
        },
        systemRuntime: {
          dialogProcessId: "dp-quote",
          sessionId: "s-quote",
        },
      },
    },
  });

  const tool = tools.find((item) => item?.name === "user_interaction");
  assert.ok(tool, "user_interaction tool should exist");

  const fields = `{"fields": [{"name": "contentPath", "displayName": "内容来源路径", "required": true, "description": "文档/媒体/网页的路径或URL，例如：/workspace/primary-user/xxx.pdf、https://example.com/page.html"}, {"name": "taskDescription", "displayName": "解析任务描述", "required": false, "description": "可选：您希望从内容中提取什么信息，如"提取文本内容"、"提取音频中的语音"等，留空则默认提取全部文本"}]}`;
  const result = parseToolJson(
    await tool.invoke({
      content: "请提供内容来源信息",
      fields,
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.fields?.length, 2);
  assert.equal(
    calls[0].fields[1].description,
    "可选：您希望从内容中提取什么信息，如\"提取文本内容\"、\"提取音频中的语音\"等，留空则默认提取全部文本",
  );
});
