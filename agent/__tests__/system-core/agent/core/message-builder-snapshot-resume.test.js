/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import {
  buildContextMessages,
  buildContextMessageBlocks,
} from "../../../../src/system-core/agent/core/context/message-builder.js";

test("buildContextMessageBlocks replays 71ad4373 stopped snapshot without tool or user_meta degradation", () => {
  const toolCallIds = [
    "call_F7IOdP5FBXqXIOcgmThZc31N",
    "call_PMqXx6xngxfSr9sRMxcECFGs",
    "call_TGw9JMNVsToP2ZkZDPPBX8Ex",
  ];
  const history = [
    new HumanMessage({
      content: "测试所有工具",
      additional_kwargs: {
        dialogProcessId: "71ad4373-b422-4b80-9dfd-4f2e05725bea",
        turnScopeId: "client-turn:mrhx43wd:2hhjjdfx",
        frontendUserMessage: true,
      },
    }),
    new HumanMessage({
      content: "[用户元信息]\n{\n  \"userName\": \"admin\"\n}",
      additional_kwargs: {
        dialogProcessId: "71ad4373-b422-4b80-9dfd-4f2e05725bea",
        turnScopeId: "client-turn:mrhx43wd:2hhjjdfx",
        frontendUserMessage: true,
        noobotInternalMessageType: "user_meta",
      },
    }),
    new HumanMessage({ content: "[来自harness外部模型输出/guidance]\n先从文件读写和脚本执行开始。" }),
    new AIMessage({
      content: "",
      tool_calls: [{ id: toolCallIds[0], name: "execute_script", args: { command: "echo test" } }],
    }),
    new ToolMessage({ tool_call_id: toolCallIds[0], content: "execute_script result" }),
    new HumanMessage({ content: "[来自harness外部模型输出/guidance]\nwrite_file 成功，接下来读回验证内容。" }),
    new AIMessage({
      content: "",
      tool_calls: [{ id: toolCallIds[1], name: "write_file", args: { filePath: "hello.txt" } }],
    }),
    new ToolMessage({ tool_call_id: toolCallIds[1], content: "write_file result" }),
    new HumanMessage({ content: "[来自harness外部模型输出/guidance]\n现在读回文件。" }),
    new AIMessage({
      content: "",
      tool_calls: [{ id: toolCallIds[2], name: "read_file", args: { filePath: "hello.txt" } }],
    }),
    new ToolMessage({ tool_call_id: toolCallIds[2], content: "read_file result" }),
  ];

  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            resumeFromStoppedSnapshot: true,
            userMessageAttachments: [],
            systemRuntime: {
              sessionId: "1b086a73-8617-4ca0-b0df-e1b741cc33b9",
              dialogProcessId: "dlg-current-71ad4373-replay",
              parentDialogProcessId: "71ad4373-b422-4b80-9dfd-4f2e05725bea",
              turnScopeId: "client-turn:current:71ad4373-replay",
            },
          },
        },
      },
      payload: {
        messages: {
          system: Array.from({ length: 7 }, (_, index) => `snapshot system ${index + 1}`),
          history,
        },
      },
    },
    { currentUserMessage: "继续" },
  );

  assert.equal(blocks.system.length, 7);
  assert.equal(
    blocks.history.filter((message) => String(message?.content || "").includes("[用户元信息]")).length,
    1,
  );
  assert.equal(
    blocks.history.some((message) => message?._getType?.() === "human" && String(message?.content || "") === ""),
    false,
  );

  const aiMessages = blocks.history.filter((message) => message?._getType?.() === "ai");
  const toolMessages = blocks.history.filter((message) => message?._getType?.() === "tool");
  assert.equal(aiMessages.length, 3);
  assert.equal(toolMessages.length, 3);
  assert.deepEqual(aiMessages.map((message) => message.tool_calls?.[0]?.id), toolCallIds);
  assert.deepEqual(toolMessages.map((message) => message.tool_call_id), toolCallIds);

  const userMetaMessages = blocks.incremental.filter((message) => String(message?.content || "").includes("[用户元信息]"));
  assert.equal(userMetaMessages.length, 1);
  assert.equal(blocks.incremental[0]?.content, "继续");
  assert.deepEqual(blocks.messages, [...blocks.system, ...blocks.history, ...blocks.incremental]);
});

test("buildContextMessageBlocks resume keeps tool pairing, single user_meta and no guidance meta", () => {
  const toolCallId = "call_resume_lock_1";
  const realDialogProcessId = "dlg-real-user";
  const realTurnScopeId = "client-turn:real-user";
  const guidanceDialogProcessId = "dlg-guidance";
  const history = [
    new HumanMessage({
      content: "测试所有工具",
      additional_kwargs: {
        dialogProcessId: realDialogProcessId,
        turnScopeId: realTurnScopeId,
        frontendUserMessage: true,
      },
    }),
    new AIMessage({
      content: "",
      tool_calls: [{ id: toolCallId, name: "write_file", args: { filePath: "a.txt" } }],
    }),
    new ToolMessage({ tool_call_id: toolCallId, content: '{"ok":true}' }),
    new HumanMessage({
      content: "继续推进任务",
      additional_kwargs: {
        dialogProcessId: guidanceDialogProcessId,
        turnScopeId: "client-turn:guidance",
        injectedMessage: true,
        injectedBy: "harness-plugin",
        injectedMessageType: "guidance",
      },
    }),
  ];

  const blocks = buildContextMessageBlocks({
    execution: { controllers: { runtime: {
      userId: "admin",
      resumeFromStoppedSnapshot: true,
      userMessageAttachments: [],
      systemRuntime: {
        sessionId: "session-resume-lock",
        dialogProcessId: "dlg-current",
        turnScopeId: "client-turn:current",
      },
    } } },
    payload: { messages: { system: [], history } },
  });
  const all = blocks.messages;
  assert.equal(all.find((message) => message?._getType?.() === "ai")?.tool_calls?.[0]?.id, toolCallId);
  assert.equal(all.find((message) => message?._getType?.() === "tool")?.tool_call_id, toolCallId);

  const metaPayloads = all
    .filter((message) => message?.additional_kwargs?.noobotInternalMessageType === "user_meta")
    .map((message) => JSON.parse(String(message.content).match(/\{[\s\S]*\}/)?.[0] || "{}"));
  assert.equal(metaPayloads.length, 1);
  assert.equal(metaPayloads[0].dialogProcessId, realDialogProcessId);
  assert.equal(metaPayloads[0].turnScopeId, realTurnScopeId);
  assert.equal(metaPayloads.some((payload) => payload.dialogProcessId === guidanceDialogProcessId), false);
  assert.ok(all.some((message) => message?.content === "继续推进任务"));
});

test("buildContextMessageBlocks rebuilds user_meta on first continue from 4c18984a stopped snapshot", () => {
  const stoppedDialogProcessId = "231ff8d0-1d49-44ee-9dd6-693ef2f007c1";
  const stoppedTurnScopeId = "client-turn:mrhzxp9r:hrrrdmu4";
  const currentDialogProcessId = "dlg-current-4c18984a-replay";
  const currentTurnScopeId = "client-turn:current:4c18984a-replay";
  const toolCallId = "call_4c18984a_first_continue";
  const snapshotAttachment = {
    attachmentId: "attachment-a",
    name: "snapshot.txt",
    mimeType: "text/plain",
    attachmentSource: "user",
    sessionId: "4c18984a-b55c-4dae-86c0-6da2577b6fb5",
  };
  const currentAttachment = {
    attachmentId: "attachment-current",
    name: "current.txt",
    mimeType: "text/plain",
    attachmentSource: "user",
    sessionId: "4c18984a-b55c-4dae-86c0-6da2577b6fb5",
  };
  const history = [
    new HumanMessage({
      content: "测试所有工具",
      additional_kwargs: {
        dialogProcessId: stoppedDialogProcessId,
        turnScopeId: stoppedTurnScopeId,
        frontendUserMessage: true,
      },
    }),
    new HumanMessage({
      content: `[用户元信息]\n${JSON.stringify({
        userName: "admin",
        sessionId: "4c18984a-b55c-4dae-86c0-6da2577b6fb5",
        parentSessionId: "",
        dialogProcessId: stoppedDialogProcessId,
        parentDialogProcessId: "",
        turnScopeId: stoppedTurnScopeId,
        attachments: [snapshotAttachment],
      }, null, 2)}\n[/用户元信息]`,
      additional_kwargs: {
        dialogProcessId: stoppedDialogProcessId,
        turnScopeId: stoppedTurnScopeId,
        noobotInternalMessageType: "user_meta",
      },
    }),
    new AIMessage({
      content: "",
      tool_calls: [{ id: toolCallId, name: "write_file", args: { filePath: "hello.txt" } }],
    }),
    new ToolMessage({ tool_call_id: toolCallId, content: "write_file result" }),
  ];

  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            resumeFromStoppedSnapshot: true,
            userMessageAttachments: [currentAttachment],
            systemRuntime: {
              sessionId: "4c18984a-b55c-4dae-86c0-6da2577b6fb5",
              dialogProcessId: currentDialogProcessId,
              parentDialogProcessId: stoppedDialogProcessId,
              turnScopeId: currentTurnScopeId,
            },
          },
        },
      },
      payload: {
        messages: {
          system: ["snapshot system"],
          history,
        },
      },
    },
    { currentUserMessage: "继续" },
  );

  assert.equal(blocks.history[0]?.content, "测试所有工具");
  assert.equal(blocks.history[1]?.additional_kwargs?.noobotInternalMessageType, "user_meta");
  const historicalMeta = JSON.parse(String(blocks.history[1]?.content || "{}").match(/\{[\s\S]*\}/)?.[0] || "{}");
  assert.equal(historicalMeta.dialogProcessId, stoppedDialogProcessId);
  assert.equal(historicalMeta.turnScopeId, stoppedTurnScopeId);
  assert.equal(historicalMeta.sessionId, "4c18984a-b55c-4dae-86c0-6da2577b6fb5");
  assert.deepEqual(historicalMeta.attachments.map((item) => item.attachmentId), ["attachment-a"]);

  assert.equal(blocks.history.some((message) => message?._getType?.() === "human" && String(message?.content || "") === ""), false);
  assert.equal(blocks.history.find((message) => message?._getType?.() === "ai")?.tool_calls?.[0]?.id, toolCallId);
  assert.equal(blocks.history.find((message) => message?._getType?.() === "tool")?.tool_call_id, toolCallId);

  assert.equal(blocks.incremental[0]?.content, "继续");
  assert.equal(blocks.incremental[1]?.additional_kwargs?.noobotInternalMessageType, "user_meta");
  const currentMeta = JSON.parse(String(blocks.incremental[1]?.content || "{}").match(/\{[\s\S]*\}/)?.[0] || "{}");
  assert.equal(currentMeta.dialogProcessId, currentDialogProcessId);
  assert.equal(currentMeta.turnScopeId, currentTurnScopeId);
  assert.deepEqual(currentMeta.attachments.map((item) => item.attachmentId), ["attachment-current"]);
  assert.deepEqual(blocks.messages, [...blocks.system, ...blocks.history, ...blocks.incremental]);
});

test("buildContextMessageBlocks keeps resumed incremental user identity and scoped attachments from 1ec8e12c resend chain", () => {
  const firstResendDialogProcessId = "dlg-1ec8e12c-resend";
  const firstResendTurnScopeId = "client-turn:mriksgyb:resend";
  const currentDialogProcessId = "dlg-1ec8e12c-current-continue";
  const currentTurnScopeId = "client-turn:current:1ec8e12c-continue";
  const attachmentA = {
    attachmentId: "529cda-docx-a",
    name: "first-stop.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    attachmentSource: "user",
    sessionId: "1ec8e12c-6c66-4f93-b4dc-57680c5c627a",
  };
  const attachmentB = {
    attachmentId: "cd0cad-docx-b",
    name: "first-resend.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    attachmentSource: "user",
    sessionId: "1ec8e12c-6c66-4f93-b4dc-57680c5c627a",
  };
  const attachmentC = {
    attachmentId: "e71b20-png-c",
    name: "continue.png",
    mimeType: "image/png",
    attachmentSource: "user",
    sessionId: "1ec8e12c-6c66-4f93-b4dc-57680c5c627a",
  };
  const history = [
    new HumanMessage({
      content: "添加附件发送后编辑重发",
      additional_kwargs: {
        dialogProcessId: firstResendDialogProcessId,
        turnScopeId: firstResendTurnScopeId,
        frontendUserMessage: true,
      },
    }),
    new HumanMessage({
      content: `[用户元信息]\n${JSON.stringify({
        userName: "admin",
        sessionId: "1ec8e12c-6c66-4f93-b4dc-57680c5c627a",
        parentSessionId: "",
        dialogProcessId: firstResendDialogProcessId,
        parentDialogProcessId: "",
        turnScopeId: firstResendTurnScopeId,
        attachments: [attachmentB],
      }, null, 2)}\n[/用户元信息]`,
      additional_kwargs: {
        dialogProcessId: firstResendDialogProcessId,
        turnScopeId: firstResendTurnScopeId,
        noobotInternalMessageType: "user_meta",
      },
    }),
    new HumanMessage({
      content: "继续前同一快照里的上一条用户消息",
      additional_kwargs: {
        dialogProcessId: "dlg-1ec8e12c-first-stop",
        turnScopeId: "client-turn:mriksgyb:first-stop",
        frontendUserMessage: true,
        attachments: [attachmentA],
      },
    }),
  ];

  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            resumeFromStoppedSnapshot: true,
            userMessageAttachments: [attachmentC],
            systemRuntime: {
              sessionId: "1ec8e12c-6c66-4f93-b4dc-57680c5c627a",
              dialogProcessId: currentDialogProcessId,
              parentDialogProcessId: firstResendDialogProcessId,
              turnScopeId: currentTurnScopeId,
            },
          },
        },
      },
      payload: {
        messages: {
          system: ["snapshot system"],
          history,
        },
      },
    },
    { currentUserMessage: "继续" },
  );

  const humanMessages = [...blocks.history, ...blocks.incremental]
    .filter((message) => message?._getType?.() === "human");
  assert.equal(humanMessages.some((message) => message.content === "添加附件发送后编辑重发"), true);
  assert.equal(humanMessages.some((message) => message.content === "继续前同一快照里的上一条用户消息"), true);

  const metaPayloads = humanMessages
    .filter((message) => message.additional_kwargs?.noobotInternalMessageType === "user_meta")
    .map((message) => JSON.parse(String(message.content || "{}").match(/\{[\s\S]*\}/)?.[0] || "{}"));
  const firstResendMeta = metaPayloads.find((payload) => payload.dialogProcessId === firstResendDialogProcessId);
  const firstStopMeta = metaPayloads.find((payload) => payload.dialogProcessId === "dlg-1ec8e12c-first-stop");
  const currentMeta = metaPayloads.find((payload) => payload.dialogProcessId === currentDialogProcessId);

  assert.deepEqual(firstResendMeta?.attachments.map((item) => item.attachmentId), ["cd0cad-docx-b"]);
  assert.deepEqual(firstStopMeta?.attachments.map((item) => item.attachmentId), ["529cda-docx-a"]);
  assert.deepEqual(currentMeta?.attachments.map((item) => item.attachmentId), ["e71b20-png-c"]);
  assert.notDeepEqual(firstResendMeta?.attachments, currentMeta?.attachments);
  assert.equal(firstResendMeta?.turnScopeId, firstResendTurnScopeId);
  assert.equal(currentMeta?.turnScopeId, currentTurnScopeId);
  assert.deepEqual(blocks.messages, [...blocks.system, ...blocks.history, ...blocks.incremental]);
});

test("buildContextMessageBlocks rebuilds user_meta on first stopped snapshot resume", () => {
  const toolCallId = "call_G91UDe5fSfBb3uhw35jQlnIO";
  const history = [
    new HumanMessage({
      content: "测试所有工具",
      additional_kwargs: {
        dialogProcessId: "c42bd1ae-8ab5-4aef-b0fb-852f8834c56c",
        turnScopeId: "client-turn:mrhzx8pp:w0y57ren",
        frontendUserMessage: true,
      },
    }),
    new HumanMessage({
      content: `[用户元信息]\n${JSON.stringify({
        userName: "admin",
        sessionId: "4c18984a-b55c-4dae-86c0-6da2577b6fb5",
        parentSessionId: "",
        dialogProcessId: "c42bd1ae-8ab5-4aef-b0fb-852f8834c56c",
        parentDialogProcessId: "",
        turnScopeId: "client-turn:mrhzx8pp:w0y57ren",
        attachments: [],
      }, null, 2)}\n[/用户元信息]`,
      additional_kwargs: {
        dialogProcessId: "c42bd1ae-8ab5-4aef-b0fb-852f8834c56c",
        turnScopeId: "client-turn:mrhzx8pp:w0y57ren",
        frontendUserMessage: true,
        noobotInternalMessageType: "user_meta",
      },
    }),
    new AIMessage({
      content: "",
      tool_calls: [{ id: toolCallId, name: "write_file", args: { filePath: "tool_test.txt" } }],
    }),
    new ToolMessage({ tool_call_id: toolCallId, content: '{"ok":true}' }),
  ];

  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "admin",
            resumeFromStoppedSnapshot: true,
            userMessageAttachments: [
              { attachmentId: "current-attachment", name: "current.txt" },
            ],
            systemRuntime: {
              sessionId: "4c18984a-b55c-4dae-86c0-6da2577b6fb5",
              dialogProcessId: "dlg-current-first-continue",
              turnScopeId: "client-turn:current:first-continue",
            },
          },
        },
      },
      payload: { messages: { system: ["snapshot system"], history } },
    },
    { currentUserMessage: "继续" },
  );

  assert.equal(blocks.system.length, 1);
  assert.equal(blocks.history[0]?.content, "测试所有工具");
  assert.equal(blocks.history[1]?.additional_kwargs?.noobotInternalMessageType, "user_meta");
  assert.equal(blocks.history[2]?._getType?.(), "ai");
  assert.equal(blocks.history[3]?._getType?.(), "tool");
  assert.equal(blocks.history[2]?.tool_calls?.[0]?.id, toolCallId);
  assert.equal(blocks.history[3]?.tool_call_id, toolCallId);

  const historyMetaPayload = JSON.parse(blocks.history[1].content.match(/\n([\s\S]*)\n\[\//)?.[1] || "{}");
  assert.equal(historyMetaPayload.dialogProcessId, "c42bd1ae-8ab5-4aef-b0fb-852f8834c56c");
  assert.equal(historyMetaPayload.turnScopeId, "client-turn:mrhzx8pp:w0y57ren");
  assert.deepEqual(historyMetaPayload.attachments, []);

  const incrementalMetaPayload = JSON.parse(blocks.incremental[1].content.match(/\n([\s\S]*)\n\[\//)?.[1] || "{}");
  assert.equal(incrementalMetaPayload.dialogProcessId, "dlg-current-first-continue");
  assert.equal(incrementalMetaPayload.turnScopeId, "client-turn:current:first-continue");
  assert.deepEqual(incrementalMetaPayload.attachments.map((item) => item.attachmentId), ["current-attachment"]);
  assert.deepEqual(blocks.messages, [...blocks.system, ...blocks.history, ...blocks.incremental]);
});
