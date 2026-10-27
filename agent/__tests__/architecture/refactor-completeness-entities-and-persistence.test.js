/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMessageEntity,
  normalizeTaskEntity,
  normalizeSessionTreeEntity,
  normalizeSelectedConnectorIds,
} from "../../src/session/entities.js";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { MESSAGE_REMOVED_FIELD_NAME } from "@noobot/session-protocol";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;

describe("2. 字段对齐测试", () => {
  describe("normalizeMessageEntity 字段对齐", () => {
    it("assistant 记录保留按角色的 modelMessageId，不产生 messageId", () => {
      const normalized = normalizeMessageEntity({
        role: "assistant",
        presentationMessageId: "pm_fx1",
        content: "hello",
        sessionId: "s_fixture",
        messageUid: "sm_assistant-1",
        ts: TEST_MESSAGE_TS,
        modelMessageId: "mm_model-1",
      });
      assert.equal("id" in normalized, false);
      assert.equal("messageId" in normalized, false);
      assert.equal(normalized.modelMessageId, "mm_model-1");
    });
    it("携带裸 messageId 的记录被拒绝", () => {
      assert.throws(
        () =>
          normalizeMessageEntity({
            role: "assistant",
            presentationMessageId: "pm_fx2",
            content: "hello",
            sessionId: "s_fixture",
            messageUid: "sm_assistant-2",
            ts: TEST_MESSAGE_TS,
            modelMessageId: "mm_model-2",
            [LEGACY_MESSAGE_ID]: "message-2",
          }),
        /session_message_messageId_removed/,
      );
    });
    it("user 只有 messageUid 时不派生任何 messageId", () => {
      const normalized = normalizeMessageEntity({
        role: "user",
        messageOrigin: "natural",
        content: "legacy user message",
        sessionId: "s_fixture",
        messageUid: "sm_persisted-1",
        ts: TEST_MESSAGE_TS,
      });
      assert.equal("id" in normalized, false);
      assert.equal("messageId" in normalized, false);
      assert.equal("userMessageId" in normalized, false);
      assert.equal(normalized.messageUid, "sm_persisted-1");
    });
    it("应包含 role, content, type, ts 等核心字段", () => {
      const raw = {
        sessionId: "s_fixture",
        messageUid: "sm_fixture_4",
        ts: TEST_MESSAGE_TS,
        role: "user",
        messageOrigin: "natural",
        content: "hello",
        type: "text",
      };
      const normalized = normalizeMessageEntity(raw);
      assert.ok("role" in normalized, "应包含 role");
      assert.ok("content" in normalized, "应包含 content");
      assert.ok("type" in normalized, "应包含 type");
      assert.ok("ts" in normalized, "应包含 ts");
    });

    it("non-canonical ts is rejected", () => {
      for (const ts of [1234567890, "2026-01-01T00:00:00Z"]) {
        assert.throws(
          () =>
            normalizeMessageEntity({
              sessionId: "s_fixture",
              messageUid: "sm_fixture_5",
              role: "user",
              messageOrigin: "natural",
              content: "test",
              ts,
            }),
          /ts_not_canonical_iso/,
        );
      }
    });

    it("missing ts is rejected instead of generated", () => {
      assert.throws(
        () =>
          normalizeMessageEntity({
            sessionId: "s_fixture",
            messageUid: "sm_fixture_6",
            modelMessageId: "mm_fixture_6",
            role: "assistant",
            presentationMessageId: "pm_fx3",
            content: "hi",
          }),
        /ts_not_canonical_iso/,
      );
    });

    it("tool_calls 字段在 type=tool_call 时应保证为数组", () => {
      const raw = {
        sessionId: "s_fixture",
        messageUid: "sm_fixture_7",
        ts: TEST_MESSAGE_TS,
        modelMessageId: "mm_fixture_7",
        role: "assistant",
        presentationMessageId: "pm_fx4",
        type: "tool_call",
        content: "",
      };
      const normalized = normalizeMessageEntity(raw);
      assert.ok(Array.isArray(normalized.tool_calls), "tool_call 类型应保证 tool_calls 为数组");
    });

    it("流程控制分类快照在调用和结果实体中保持一致", () => {
      const contextPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
      const call = normalizeMessageEntity({
        sessionId: "s_fixture",
        messageUid: "sm_fixture_8",
        ts: TEST_MESSAGE_TS,
        modelMessageId: "mm_fixture_8",
        role: "assistant",
        presentationMessageId: "pm_fx5",
        type: "tool_call",
        content: "",
        tool_calls: [{ id: "call-1", function: { name: "control" }, contextPolicy }],
      });
      const result = normalizeMessageEntity({
        sessionId: "s_fixture",
        messageUid: "sm_fixture_9",
        ts: TEST_MESSAGE_TS,
        role: "tool",
        presentationMessageId: "pm_fx6",
        type: "tool_result",
        content: "",
        tool_call_id: "call-1",
        toolName: "control",
        contextPolicy,
      });

      assert.deepEqual(call.tool_calls[0].contextPolicy, contextPolicy);
      assert.deepEqual(result.contextPolicy, contextPolicy);
    });

    it("summarized 字段默认应为 false", () => {
      const raw = {
        sessionId: "s_fixture",
        messageUid: "sm_fixture_10",
        ts: TEST_MESSAGE_TS,
        role: "user",
        messageOrigin: "natural",
        content: "test",
      };
      const normalized = normalizeMessageEntity(raw);
      assert.equal(normalized.summarized, false, "summarized 默认应为 false");
    });

    it("assistant 协议内容块必须落盘以支持 thinking/tool 轮次恢复", () => {
      const raw1 = {
        sessionId: "s_fixture",
        messageUid: "sm_fixture_11",
        ts: TEST_MESSAGE_TS,
        role: "user",
        messageOrigin: "natural",
        content: "test",
        rawModelContent: "raw text",
      };
      const n1 = normalizeMessageEntity(raw1);
      assert.ok(!("rawModelContent" in n1), "string rawModelContent 默认不落盘");

      const rawSig = {
        sessionId: "s_fixture",
        messageUid: "sm_fixture_12",
        ts: TEST_MESSAGE_TS,
        modelMessageId: "mm_fixture_12",
        role: "assistant",
        presentationMessageId: "pm_fx7",
        content: "test",
        rawModelContent: [{ type: "text", text: "x", thought_signature: "sig-1" }],
      };
      const nSig = normalizeMessageEntity(rawSig);
      assert.deepEqual(nSig.rawModelContent, rawSig.rawModelContent);
      assert.notEqual(nSig.rawModelContent, rawSig.rawModelContent);

      const raw2 = {
        sessionId: "s_fixture",
        messageUid: "sm_fixture_13",
        ts: TEST_MESSAGE_TS,
        role: "user",
        messageOrigin: "natural",
        content: "test",
        rawModelContent: 123,
      };
      const n2 = normalizeMessageEntity(raw2);
      assert.ok(!("rawModelContent" in n2), "非 string/array rawModelContent 不应保留");
    });

    it("仅 OpenAI Responses 协议字段落盘，诊断字段不落盘", () => {
      const raw1 = {
        sessionId: "s_fixture",
        messageUid: "sm_fixture_14",
        ts: TEST_MESSAGE_TS,
        modelMessageId: "mm_fixture_14",
        role: "assistant",
        presentationMessageId: "pm_fx8",
        content: "test",
        modelAdditionalKwargs: {
          reasoning: { type: "reasoning", id: "rs_1", encrypted_content: "enc" },
          key: "val",
        },
        modelResponseMetadata: {
          output: [{ type: "reasoning", id: "rs_1", encrypted_content: "enc" }],
          finish_reason: "tool_calls",
        },
      };
      const n1 = normalizeMessageEntity(raw1);
      assert.deepEqual(n1.modelAdditionalKwargs, {
        reasoning: { type: "reasoning", id: "rs_1", encrypted_content: "enc" },
      });
      assert.deepEqual(n1.modelResponseMetadata, {
        output: [{ type: "reasoning", id: "rs_1", encrypted_content: "enc" }],
      });

      const raw2 = {
        sessionId: "s_fixture",
        messageUid: "sm_fixture_15",
        ts: TEST_MESSAGE_TS,
        role: "user",
        messageOrigin: "natural",
        content: "test",
        modelAdditionalKwargs: [1, 2],
      };
      const n2 = normalizeMessageEntity(raw2);
      assert.ok(!("modelAdditionalKwargs" in n2), "array modelAdditionalKwargs 不应保留");
    });
  });

  describe("normalizeTaskEntity 字段对齐", () => {
    it("应包含 taskId, taskName, taskStatus, startedAt, endedAt, result, meta 字段", () => {
      const raw = { taskId: "task-1", taskName: "test task", taskStatus: "completed" };
      const normalized = normalizeTaskEntity(raw);
      const requiredFields = [
        "taskId",
        "taskName",
        "taskStatus",
        "startedAt",
        "endedAt",
        "result",
        "meta",
      ];
      for (const field of requiredFields) {
        assert.ok(field in normalized, `应包含 ${field}`);
      }
    });

    it("taskStatus 仅 start/completed 有效，其他为空字符串", () => {
      const n1 = normalizeTaskEntity({ taskId: "t1", taskStatus: "start" });
      assert.equal(n1.taskStatus, "start");

      const n2 = normalizeTaskEntity({ taskId: "t2", taskStatus: "completed" });
      assert.equal(n2.taskStatus, "completed");

      const n3 = normalizeTaskEntity({ taskId: "t3", taskStatus: "running" });
      assert.equal(n3.taskStatus, "", "running 应转为空字符串");
    });

    it("meta 字段缺失时默认为空对象", () => {
      const normalized = normalizeTaskEntity({ taskId: "t1" });
      assert.deepEqual(normalized.meta, {}, "meta 默认应为空对象");
    });
  });

  describe("normalizeSessionTreeEntity 字段对齐", () => {
    it("只包含 nodes 字段", () => {
      const normalized = normalizeSessionTreeEntity({
        nodes: {
          "session-1": { sessionId: "session-1", parentSessionId: "", caller: SESSION_CALLER.USER },
        },
      });
      assert.deepEqual(normalized, {
        nodes: {
          "session-1": { sessionId: "session-1", parentSessionId: "", caller: SESSION_CALLER.USER },
        },
      });
    });

    it("拒绝带时间戳的旧版会话树", () => {
      assert.throws(() => normalizeSessionTreeEntity({ nodes: {}, updatedAt: "t" }), TypeError);
      assert.throws(
        () =>
          normalizeSessionTreeEntity({ nodes: { s1: { parentSessionId: "", createdAt: "t" } } }),
        TypeError,
      );
    });

    it("nodes 中每个节点保留 sessionId、parentSessionId 和 caller", () => {
      const raw = {
        nodes: {
          s1: { sessionId: "s1", parentSessionId: "", caller: SESSION_CALLER.USER },
          s2: { sessionId: "s2", parentSessionId: "s1", caller: SESSION_CALLER.BOT },
        },
      };
      const normalized = normalizeSessionTreeEntity(raw);
      assert.equal(normalized.nodes["s1"].sessionId, "s1");
      assert.equal(normalized.nodes["s1"].parentSessionId, "");
      assert.equal(normalized.nodes["s2"].parentSessionId, "s1");
      assert.equal(normalized.nodes["s2"].caller, "bot");
      assert.equal("children" in normalized.nodes["s1"], false);
    });
  });

  describe("normalizeSelectedConnectorIds 字段对齐", () => {
    it("应保留唯一且有序的连接器 ID", () => {
      const normalized = normalizeSelectedConnectorIds(["con_1", "con_1", "con_2"]);
      assert.deepEqual(normalized, ["con_1", "con_2"]);
    });

    it("空对象应返回空对象", () => {
      assert.deepEqual(normalizeSelectedConnectorIds([]), []);
    });

    it("非对象输入应返回空对象", () => {
      assert.deepEqual(normalizeSelectedConnectorIds(null), []);
      assert.deepEqual(normalizeSelectedConnectorIds(undefined), []);
      assert.deepEqual(normalizeSelectedConnectorIds("invalid"), []);
    });
  });
});

describe("3. Session 字段完整性测试", () => {
  describe("Session 运行时实体结构验证", () => {
    it("Session 应包含 sessionId, userId, scenario, status, createdAt, updatedAt", () => {
      const session = {
        sessionId: "sess-1",
        userId: "primary-user",
        scenario: "programming",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        parentSessionId: "",
        children: [],
        messages: [],
        tasks: [],
        config: {},
        metadata: {},
      };

      const requiredFields = [
        "sessionId",
        "userId",
        "scenario",
        "status",
        "createdAt",
        "updatedAt",
        "parentSessionId",
        "children",
        "messages",
        "tasks",
        "config",
        "metadata",
      ];

      for (const field of requiredFields) {
        assert.ok(field in session, `Session 应包含字段: ${field}`);
      }
    });

    it("Task 实体应包含 taskId, taskName, taskStatus, startedAt, endedAt, result, meta", () => {
      const task = normalizeTaskEntity({
        taskId: "task-1",
        taskName: "execute script",
        taskStatus: "completed",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: "success",
        meta: { exitCode: 0 },
      });

      const requiredFields = [
        "taskId",
        "taskName",
        "taskStatus",
        "startedAt",
        "endedAt",
        "result",
        "meta",
      ];
      for (const field of requiredFields) {
        assert.ok(field in task, `Task 应包含字段: ${field}`);
      }
    });

    it("Message 实体应包含 role, content, type, ts, summarized", () => {
      const message = normalizeMessageEntity({
        sessionId: "s_fixture",
        messageUid: "sm_fixture_16",
        role: "user",
        messageOrigin: "natural",
        content: "hello",
        type: "text",
        ts: TEST_MESSAGE_TS,
      });

      const requiredFields = ["role", "content", "type", "ts", "summarized"];
      for (const field of requiredFields) {
        assert.ok(field in message, `Message 应包含字段: ${field}`);
      }
    });
  });
});

describe("4. 落盘字段完整性测试", () => {
  describe("session.json 落盘结构", () => {
    it("落盘 session.json 应包含完整字段", () => {
      const diskSession = {
        sessionId: "sess-1",
        userId: "primary-user",
        scenario: "programming",
        status: "completed",
        parentSessionId: "",
        children: [],
        config: {
          model: "openai:gpt-4",
          maxContextTurns: 50,
          selectedConnectorIds: [],
        },
        metadata: {
          totalTurns: 10,
          totalTokens: 5000,
          startTime: Date.now(),
          endTime: Date.now(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const requiredFields = [
        "sessionId",
        "userId",
        "scenario",
        "status",
        "parentSessionId",
        "children",
        "config",
        "metadata",
        "createdAt",
        "updatedAt",
      ];

      for (const field of requiredFields) {
        assert.ok(field in diskSession, `session.json 应包含字段: ${field}`);
      }
    });
  });

  describe("task.json 落盘结构", () => {
    it("落盘 task.json 应包含完整字段", () => {
      const diskTask = {
        taskId: "task-1",
        taskName: "execute script",
        taskStatus: "completed",
        skillName: "default",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: "success",
        meta: { exitCode: 0, duration: 150 },
      };

      const requiredFields = [
        "taskId",
        "taskName",
        "taskStatus",
        "skillName",
        "startedAt",
        "endedAt",
        "result",
        "meta",
      ];

      for (const field of requiredFields) {
        assert.ok(field in diskTask, `task.json 应包含字段: ${field}`);
      }
    });
  });
});
