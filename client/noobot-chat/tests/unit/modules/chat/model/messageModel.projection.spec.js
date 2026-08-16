/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildViewMessage,
  findVisibleLastMessage,
  foldConversationMessages,
} from "../../../../../src/modules/chat/model/messageModel.js";

describe("messageModel projections", () => {
  it("does not admit workflow running view models into canonical messages", () => {
    const message = buildViewMessage({
      role: "assistant",
      type: "message",
      content: "",
      pending: true,
      synthetic: true,
      placeholder: true,
      turnPlaceholder: true,
      workflowNodeRunningPlaceholder: true,
    });

    expect(message).toMatchObject({
      pending: true,
      synthetic: true,
      placeholder: true,
      turnPlaceholder: true,
    });
    expect(message).not.toHaveProperty("workflowNodeRunningPlaceholder");
  });

  it("keeps turn UI state out of message projections", () => {
    expect(buildViewMessage({ role: "assistant", pending: true })).not.toHaveProperty(
      "thinkingOpenNames",
    );
    expect(buildViewMessage({ role: "assistant" })).not.toHaveProperty("expandedToolDetailKeys");
    expect(buildViewMessage({ role: "user" })).not.toHaveProperty("thinkingOpenNames");
  });

  it("finds the last user-visible message and skips harness injected relay messages", () => {
    const userMessage = { role: "user", content: "real request" };
    const assistantMessage = { role: "assistant", content: "real answer" };
    const harnessRelay = {
      role: "user",
      content: "[来自harness外部模型输出/planning] hidden relay",
      injectedMessage: true,
      injectedBy: "harness-plugin",
    };

    expect(findVisibleLastMessage([userMessage, assistantMessage, harnessRelay])).toBe(
      assistantMessage,
    );
    expect(findVisibleLastMessage([harnessRelay])).toBe(null);
  });

  it("renders serialized LangChain human and ai messages as user and assistant", () => {
    const messages = foldConversationMessages(
      [
        {
          lc_id: ["langchain_core", "messages", "human", "HumanMessage"],
          type: "constructor",
          kwargs: { content: "question from serialized human" },
        },
        {
          lc_id: ["langchain_core", "messages", "ai", "AIMessage"],
          type: "constructor",
          kwargs: { content: "answer from serialized ai" },
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "question from serialized human",
      type: "message",
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "answer from serialized ai",
      type: "message",
    });
  });

  it("keeps thinking timing fields out of backend view messages after refresh", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "running",
      thinkingStartedAt: "2026-06-22T10:00:00.000Z",
      thinkingFinishedAt: "2026-06-22T10:00:12.000Z",
    });

    expect(message.thinkingStartedAt).toBeUndefined();
    expect(message.thinkingFinishedAt).toBeUndefined();
  });

  it("uses backend createdAt as message timestamp so pending thinking elapsed does not reset after refresh", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "running",
      pending: true,
      createdAt: "2026-06-22T10:00:00.000Z",
    });

    expect(message.ts).toBe("2026-06-22T10:00:00.000Z");
  });

  it("does not expose backend turn/message identity aliases", () => {
    const message = buildViewMessage({
      role: "user",
      content: "edit me",
      id: "storage-id-1",
      turnScopeId: "client-turn:backend-scope-1",
    });

    expect(message.id).toBe("storage-id-1");
    expect(message.turnScopeId).toBe("client-turn:backend-scope-1");
  });

  it("preserves parent dialog process id for related attachment aggregation", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      dialogProcessId: "child-dp",
      parentDialogProcessId: "root-dp",
    });

    expect(message.parentDialogProcessId).toBe("root-dp");
  });

  it("preserves summary thinking entry fields on view messages", () => {
    const message = buildViewMessage({
      role: "assistant",
      content: "done",
      hasThinkingDetails: true,
      thinkingDetailCount: 2,
    });

    expect(message.hasThinkingDetails).toBe(true);
    expect(message.thinkingDetailCount).toBe(2);
  });
});
