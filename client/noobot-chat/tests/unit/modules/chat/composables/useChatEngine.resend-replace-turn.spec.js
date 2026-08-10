/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  makeSession,
  makeTurnReplacementResponse,
  assistantMessage,
  emitChannelState,
  emitAuthorityProcessing,
} from "../helpers/useChatEngineHarness.js";
import {
  BackendChannelState,
  FrontendRunState,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

describe("useChatEngine.resend replace turn", () => {
  it("does not start a stale resend stream after delete supersedes its pending replace command", async () => {
    let resolveReplace;
    const replaceResponse = new Promise((resolve) => {
      resolveReplace = resolve;
    });
    const stream = vi.fn();
    const replaceSessionTurnApi = vi.fn(() => replaceResponse);
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "resend-delete-race",
        aggregateVersion: 3,
        deletedTurnScopeIds: ["client-turn:old"],
        session: {
          sessionId: "resend-delete-race",
          aggregateVersion: 3,
          revision: 3,
          messages: [],
          rawMessages: [],
        },
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "resend-delete-race",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const user = {
      id: "old-user",
      messageId: "old-user",
      turnScopeId: "client-turn:old",
      role: RoleEnum.USER,
      content: "old question",
    };
    const assistant = {
      id: "old-assistant",
      messageId: "old-assistant",
      turnScopeId: "client-turn:old",
      role: RoleEnum.ASSISTANT,
      content: "old answer",
      stopState: "user_stopped",
      channelState: { state: "user_stopped" },
    };
    activeSession.value.messages = [user, assistant];
    activeSession.value.rawMessages = [user, assistant];
    activeSession.value.aggregateVersion = 1;

    const resendPromise = engine.resendMonotonicMessage(assistant, "edited question", {
      turnScopeId: "client-turn:replacement",
    });
    await vi.waitFor(() => expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1));

    await expect(engine.deleteMonotonicMessage(user)).resolves.toBe(true);
    const resendRequest = replaceSessionTurnApi.mock.calls[0][0];
    resolveReplace(
      makeTurnReplacementResponse({
        commandId: resendRequest.commandId,
        sessionId: "resend-delete-race",
        aggregateVersion: 2,
        replacedTurnScopeIds: ["client-turn:old"],
        replacementUser: {
          id: "replacement-user",
          messageId: "replacement-user",
          turnScopeId: "client-turn:replacement",
          role: RoleEnum.USER,
          content: "edited question",
        },
      }),
    );

    await expect(resendPromise).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([]);
  });

  it("resendMonotonicMessage continues generation after atomic replace-turn returns user-only snapshot", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      emitAuthorityProcessing(onEvent, payload);
    });
    const deleteSessionMessagesFromApi = vi.fn();
    const removeWorkflowOwnersForReplacedTurns = vi.fn(() => ({
      removedWorkflowRunIds: ["workflow:client-turn:old"],
      removedSessionIds: ["child-session-old"],
    }));
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, commandId, anchor }) => {
      const replacementUser = {
        id: "msg-user-replace-success",
        messageId: "msg-user-replace-success",
        turnScopeId,
        role: RoleEnum.USER,
        content: "edited question",
      };
      return makeTurnReplacementResponse({
        commandId,
        sessionId: "local-resend-replace-success",
        aggregateVersion: 4,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
        session: { messageCount: 1 },
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
      input.value = "";
    });
    const { engine, activeSession, input, appendMessage, sending, canStop, activeTurnRuntime } =
      createHarness({
        sessionId: "local-resend-replace-success",
        stream,
        deps: {
          replaceSessionTurnApi,
          deleteSessionMessagesFromApi,
          applySessionDetail,
          removeWorkflowOwnersForReplacedTurns,
        },
      });
    const first = { turnScopeId: "client-turn:old", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "client-turn:old", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.aggregateVersion = 3;
    input.value = "draft before replace";

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(true);

    expect(replaceSessionTurnApi).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "local-resend-replace-success",
        parentSessionId: "",
        anchor: { turnScopeId: "client-turn:old" },
        newContent: "edited question",
        turnScopeId: expect.stringMatching(/^client-turn:/),
        expectedAggregateVersion: 3,
        commandId: expect.any(String),
      }),
      expect.any(Object),
    );
    expect(applySessionDetail.mock.calls[0][1]).toEqual({
      mode: "delete-confirmed",
      deletedTurnScopeIds: ["client-turn:old"],
    });
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(removeWorkflowOwnersForReplacedTurns).toHaveBeenCalledWith({
      parentSessionId: "local-resend-replace-success",
      replacedTurnScopeIds: ["client-turn:old"],
    });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0].input.message).toBe("edited question");
    expect(stream.mock.calls[0][0].identity.sessionId).toBe("local-resend-replace-success");
    expect(stream.mock.calls[0][0].identity.turnScopeId).toEqual(
      expect.stringMatching(/^client-turn:/),
    );
    expect(stream.mock.calls[0][0].commandType).toBe("turn.resend");
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(activeTurnRuntime.value.state).toBe(FrontendRunState.PROCESSING);
    expect(activeTurnRuntime.value.backendState).toBe(BackendChannelState.SENDING);
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(appendMessage).not.toHaveBeenCalledWith(RoleEnum.USER, "edited question", []);
    expect(appendMessage).toHaveBeenCalledWith(
      RoleEnum.ASSISTANT,
      "",
      [],
      expect.objectContaining({
        id: expect.stringMatching(/^msg_/),
        messageId: expect.stringMatching(/^msg_/),
        sessionId: "local-resend-replace-success",
        turnScopeId: expect.stringMatching(/^client-turn:/),
      }),
    );
    expect(
      activeSession.value.messages.filter((message) => message.role === RoleEnum.USER),
    ).toHaveLength(1);
    expect(activeSession.value.messages.map((message) => message.content)).toEqual([
      "edited question",
      "",
    ]);
    expect(activeSession.value.messages[0].turnScopeId).toBe(
      activeSession.value.messages[1].turnScopeId,
    );
    const replacementUserIndex = activeSession.value.messages.findIndex(
      (message) => message.role === RoleEnum.USER && message.content === "edited question",
    );
    const canonicalAssistantIndex = activeSession.value.messages.findIndex(
      (message) => message.role === RoleEnum.ASSISTANT && /^msg_/.test(message.messageId || ""),
    );
    expect(canonicalAssistantIndex).toBeGreaterThan(replacementUserIndex);
    expect(activeSession.value.messages[canonicalAssistantIndex]).not.toHaveProperty(
      "turnPlaceholder",
    );
    expect(input.value).toBe("");
  });

  it("resendMonotonicMessage sends edited attachment set to replace-turn and stream payload", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      emitAuthorityProcessing(onEvent, payload);
    });
    const keptAttachment = {
      attachmentId: "kept",
      sessionId: "local-resend-attachments",
      attachmentSource: "test",
      name: "kept.txt",
    };
    const removedAttachment = {
      attachmentId: "removed",
      sessionId: "local-resend-attachments",
      attachmentSource: "test",
      name: "removed.txt",
    };
    const newAttachment = { name: "new.txt", mimeType: "text/plain", contentBase64: "bmV3" };
    const localFile = {
      raw: new File(["new"], "new.txt", { type: "text/plain" }),
      clientAttachmentId: "draft-new",
      name: "new.txt",
      mimeType: "text/plain",
    };
    const replaceSessionTurnApi = vi.fn(
      async ({ turnScopeId, newContent, attachments, commandId, anchor }) => {
        const canonicalAttachments = attachments.map((attachment, index) =>
          attachment.contentBase64
            ? {
                ...attachment,
                attachmentId: `canonical-${index}`,
                attachmentSource: "test",
                sessionId: "local-resend-attachments",
                path: `/attachments/canonical-${index}`,
              }
            : attachment,
        );
        const replacementUser = {
          id: "msg-user-resend-attachments",
          messageId: "msg-user-resend-attachments",
          turnScopeId,
          role: RoleEnum.USER,
          content: newContent,
          attachments: canonicalAttachments.map(({ contentBase64, ...attachment }) => attachment),
        };
        return makeTurnReplacementResponse({
          commandId,
          sessionId: "local-resend-attachments",
          aggregateVersion: 4,
          replacedTurnScopeIds: [anchor.turnScopeId],
          replacementUser,
        });
      },
    );
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-attachments",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:attachments-old",
      role: RoleEnum.USER,
      content: "old",
      attachments: [keptAttachment, removedAttachment],
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:attachments-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      stopState: "user_stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.aggregateVersion = 3;

    await expect(
      engine.resendMonotonicMessage(stoppedAssistant, "edited with attachments", {
        attachments: [keptAttachment],
        attachmentFiles: [localFile],
        removedAttachmentKeys: ['["local-resend-attachments","test","removed"]'],
      }),
    ).resolves.toBe(true);

    const expectedAttachments = [
      keptAttachment,
      { ...newAttachment, clientAttachmentId: "draft-new" },
    ];
    expect(replaceSessionTurnApi).toHaveBeenCalledWith(
      expect.objectContaining({
        newContent: "edited with attachments",
        attachments: expectedAttachments,
      }),
      expect.any(Object),
    );
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        commandType: "turn.resend",
        input: expect.objectContaining({
          message: "edited with attachments",
          attachments: [
            keptAttachment,
            expect.objectContaining({
              attachmentId: "canonical-1",
              name: "new.txt",
              sessionId: "local-resend-attachments",
            }),
          ],
        }),
      }),
    );
    expect(activeSession.value.messages[0].attachments).toEqual([
      keptAttachment,
      expect.objectContaining({
        attachmentId: "canonical-1",
        name: "new.txt",
        sessionId: "local-resend-attachments",
      }),
    ]);
    expect(activeSession.value.messages[0].attachments[1]).not.toHaveProperty("contentBase64");
  });

  it("preserves target attachments when the editor did not explicitly remove them", async () => {
    const originalAttachment = {
      attachmentId: "original",
      sessionId: "local-resend-preserve-baseline",
      attachmentSource: "test",
      name: "original.docx",
    };
    const localFile = {
      raw: new File(["new"], "new.txt", { type: "text/plain" }),
      clientAttachmentId: "draft-new",
      name: "new.txt",
      mimeType: "text/plain",
    };
    const replaceSessionTurnApi = vi.fn(
      async ({ turnScopeId, newContent, attachments, commandId, anchor }) => {
        const replacementUser = {
          id: "msg-user-preserve-baseline",
          messageId: "msg-user-preserve-baseline",
          turnScopeId,
          role: RoleEnum.USER,
          content: newContent,
          attachments,
        };
        return makeTurnReplacementResponse({
          commandId,
          sessionId: "local-resend-preserve-baseline",
          aggregateVersion: 2,
          replacedTurnScopeIds: [anchor.turnScopeId],
          replacementUser,
        });
      },
    );
    const applySessionDetail = vi.fn((detail) => {
      activeSession.value = { ...activeSession.value, ...(detail.sessions?.[0] || {}) };
    });
    const stream = vi.fn(async () => {});
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-preserve-baseline",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:preserve-old",
      role: RoleEnum.USER,
      content: "old",
      attachments: [originalAttachment],
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:preserve-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      stopState: "user_stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];

    await engine.resendMonotonicMessage(stoppedAssistant, "edited", {
      attachments: [],
      attachmentFiles: [localFile],
      removedAttachmentKeys: [],
    });

    expect(replaceSessionTurnApi).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          originalAttachment,
          {
            clientAttachmentId: "draft-new",
            name: "new.txt",
            mimeType: "text/plain",
            contentBase64: "bmV3",
          },
        ],
      }),
      expect.any(Object),
    );
  });

  it("resendMonotonicMessage keeps original attachment when editing without attachment changes", async () => {
    const stream = vi.fn(async () => {});
    const originalAttachment = {
      attachmentId: "attachment-a",
      sessionId: "local-resend-unchanged-attachment",
      attachmentSource: "test",
      name: "a.txt",
      mimeType: "text/plain",
      contentBase64: "YQ==",
    };
    const replaceSessionTurnApi = vi.fn(
      async ({ turnScopeId, newContent, attachments, commandId, anchor }) => {
        const replacementUser = {
          id: "msg-user-unchanged-attachment",
          messageId: "msg-user-unchanged-attachment",
          turnScopeId,
          role: RoleEnum.USER,
          content: newContent,
          attachments,
        };
        return makeTurnReplacementResponse({
          commandId,
          sessionId: "local-resend-unchanged-attachment",
          aggregateVersion: 4,
          replacedTurnScopeIds: [anchor.turnScopeId],
          replacementUser,
        });
      },
    );
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-unchanged-attachment",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:unchanged-attachment-old",
      role: RoleEnum.USER,
      content: "old with attachment A",
      attachments: [originalAttachment],
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:unchanged-attachment-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      stopState: "user_stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.aggregateVersion = 3;

    await expect(
      engine.resendMonotonicMessage(stoppedAssistant, "old with attachment A", {
        attachments: [originalAttachment],
        attachmentFiles: [],
      }),
    ).resolves.toBe(true);

    expect(replaceSessionTurnApi).toHaveBeenCalledWith(
      expect.objectContaining({
        newContent: "old with attachment A",
        attachments: [originalAttachment],
      }),
      expect.any(Object),
    );
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        input: { message: "old with attachment A", attachments: [originalAttachment] },
      }),
    );
    expect(activeSession.value.messages[0].attachments).toEqual([originalAttachment]);
  });

  it("resendMonotonicMessage keeps rich parsed attachment fields when serialized payload is raw", async () => {
    const richAttachment = {
      attachmentId: "attachment-rich",
      attachmentSource: "test",
      name: "AI 体系现状概览.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 1407731,
      sessionId: "session-rich",
      path: "/workspace/admin/runtime/attach/scoped/session-rich/user/attachment-rich.docx",
      relativePath: "runtime/attach/scoped/session-rich/user/attachment-rich.docx",
      sandboxPath: "/workspace/admin/runtime/attach/scoped/session-rich/user/attachment-rich.docx",
      previewUrl: "/preview/attachment-rich",
      downloadUrl: "/download/attachment-rich",
      parsedResult: {
        attachmentId: "parsed-rich",
        sessionId: "session-rich",
        attachmentSource: "test",
        name: "AI 体系现状概览.md",
        path: "/workspace/admin/runtime/attach/scoped/session-rich/model/parsed-rich.md",
        relativePath: "runtime/attach/scoped/session-rich/model/parsed-rich.md",
      },
      parsedResultAttachmentId: "parsed-rich",
      parsedResultUrl: "/download/parsed-rich",
    };
    const rawAttachment = {
      name: richAttachment.name,
      mimeType: richAttachment.mimeType,
      size: richAttachment.size,
    };
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(
      async ({ turnScopeId, newContent, attachments, commandId, anchor }) => {
        const replacementUser = {
          id: "msg-user-rich-raw",
          messageId: "msg-user-rich-raw",
          turnScopeId,
          role: RoleEnum.USER,
          content: newContent,
          attachments,
        };
        return makeTurnReplacementResponse({
          commandId,
          sessionId: "local-resend-rich-raw",
          aggregateVersion: 4,
          replacedTurnScopeIds: [anchor.turnScopeId],
          replacementUser,
        });
      },
    );
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-rich-raw",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:rich-raw-old",
      role: RoleEnum.USER,
      content: "old with rich attachment",
      attachments: [richAttachment],
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:rich-raw-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      stopState: "user_stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.aggregateVersion = 3;

    await expect(
      engine.resendMonotonicMessage(stoppedAssistant, "old with rich attachment", {
        attachments: [richAttachment],
        attachmentFiles: [],
      }),
    ).resolves.toBe(true);

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              attachmentId: "attachment-rich",
              parsedResultAttachmentId: "parsed-rich",
            }),
          ],
        }),
      }),
      expect.any(Function),
    );
    expect(activeSession.value.messages[0].attachments).toEqual([
      expect.objectContaining({
        attachmentId: "attachment-rich",
        path: richAttachment.path,
        relativePath: richAttachment.relativePath,
        sandboxPath: richAttachment.sandboxPath,
        previewUrl: "/preview/attachment-rich",
        downloadUrl: "/download/attachment-rich",
        parsedResultAttachmentId: "parsed-rich",
        parsedResultUrl: "/download/parsed-rich",
        parsedResult: expect.objectContaining({ attachmentId: "parsed-rich" }),
      }),
    ]);
    expect(activeSession.value.messages[0].attachments[0]).toEqual(
      expect.objectContaining(rawAttachment),
    );
  });

  it("resendMonotonicMessage preserves explicit empty attachment deletion", async () => {
    const stream = vi.fn(async () => {});
    const oldAttachment = {
      attachmentId: "old",
      sessionId: "local-resend-delete-attachments",
      attachmentSource: "test",
      name: "old.txt",
      parsedResultAttachmentId: "parsed-old",
    };
    const replaceSessionTurnApi = vi.fn(
      async ({ turnScopeId, newContent, attachments, commandId, anchor }) => {
        const replacementUser = {
          id: "msg-user-delete-attachments",
          messageId: "msg-user-delete-attachments",
          turnScopeId,
          role: RoleEnum.USER,
          content: newContent,
          attachments,
        };
        return makeTurnReplacementResponse({
          commandId,
          sessionId: "local-resend-delete-attachments",
          aggregateVersion: 4,
          replacedTurnScopeIds: [anchor.turnScopeId],
          replacementUser,
        });
      },
    );
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-delete-attachments",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:delete-attachments-old",
      role: RoleEnum.USER,
      content: "old",
      attachments: [oldAttachment],
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:delete-attachments-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      stopState: "user_stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.aggregateVersion = 3;

    await expect(
      engine.resendMonotonicMessage(stoppedAssistant, "old", {
        attachments: [],
        attachmentFiles: [],
        removedAttachmentKeys: ['["local-resend-delete-attachments","test","old"]'],
      }),
    ).resolves.toBe(true);

    expect(replaceSessionTurnApi).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [] }),
      expect.any(Object),
    );
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ attachments: [] }),
      }),
      expect.any(Function),
    );
    expect(activeSession.value.messages[0].attachments).toEqual([]);
  });

  it("resendMonotonicMessage treats a version conflict as terminal and never rebases a stale replacement", async () => {
    const stream = vi.fn(async () => {});
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-version-retry",
      sessions: [
        makeSession("local-resend-version-retry", {
          aggregateVersion: 5,
          revision: 5,
          messages: [
            { turnScopeId: "client-turn:old-version", role: RoleEnum.USER, content: "old" },
            {
              turnScopeId: "client-turn:old-version",
              role: RoleEnum.ASSISTANT,
              content: "stopped",
              stopState: "user_stopped",
            },
          ],
        }),
      ],
    }));
    const replaceSessionTurnApi = vi.fn(async () => ({
      ok: false,
      status: 409,
      statusText: "Conflict",
      error: "session version conflict",
      errorCode: "SESSION_VERSION_CONFLICT",
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, appendMessage } = createHarness({
      sessionId: "local-resend-version-retry",
      stream,
      deps: { replaceSessionTurnApi, fetchSessionDetail, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:old-version",
      role: RoleEnum.USER,
      content: "old",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:old-version",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      stopState: "user_stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.aggregateVersion = 3;
    activeSession.value.revision = 3;

    await expect(
      engine.resendMonotonicMessage(stoppedAssistant, "edited after conflict"),
    ).resolves.toBe(false);

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(replaceSessionTurnApi.mock.calls[0][0]).toEqual(
      expect.objectContaining({ expectedAggregateVersion: 3 }),
    );
    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("resendMonotonicMessage ignores stopped assistant returned with the fresh replacement turn and continues streaming", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      emitAuthorityProcessing(onEvent, payload);
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, commandId, anchor }) => {
      const replacementUser = {
        id: "msg-user-fresh-stopped-assistant",
        messageId: "msg-user-fresh-stopped-assistant",
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
      };
      return makeTurnReplacementResponse({
        commandId,
        sessionId: "local-resend-fresh-stopped-assistant",
        aggregateVersion: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, sending, canStop, activeTurnRuntime } = createHarness({
      sessionId: "local-resend-fresh-stopped-assistant",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:first-old",
      role: RoleEnum.USER,
      content: "first stopped",
      stopState: "user_stopped",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:first-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: false,
      statusLabel: "chat.stopped",
      stopState: "user_stopped",
      channelState: { state: "user_stopped", turnScopeId: "client-turn:first-old" },
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(
      engine.resendMonotonicMessage(stoppedAssistant, "edited first resend"),
    ).resolves.toBe(true);

    expect(stream).toHaveBeenCalledTimes(1);
    const [replacementUser, placeholder] = activeSession.value.messages;
    expect(replacementUser).toEqual(
      expect.objectContaining({
        role: RoleEnum.USER,
        content: "edited first resend",
        turnScopeId: expect.stringMatching(/^client-turn:/),
      }),
    );
    expect(placeholder).toEqual(
      expect.objectContaining({
        role: RoleEnum.ASSISTANT,
        content: "",
        pending: false,
        statusLabel: "",
        turnScopeId: replacementUser.turnScopeId,
      }),
    );
    expect(activeSession.value.messages).toHaveLength(2);
    expect(
      activeSession.value.messages.some((message) => message.stopState === "user_stopped"),
    ).toBe(false);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(activeTurnRuntime.value.state).toBe(FrontendRunState.PROCESSING);
    expect(activeTurnRuntime.value.backendState).toBe(BackendChannelState.SENDING);
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
  });
});
