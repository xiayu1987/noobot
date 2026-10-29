/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  applyMainEntryMessages,
  createHarness,
  makeTurnReplacementBody,
  makeTurnReplacementResponse,
} from "../helpers/useChatEngineHarness.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { logStateMachineDebug } from "../../../../../src/modules/debug/loggers/stateMachineLogger.js";
import { NO_ATTACHMENT_EDITS } from "../../../helpers/resendEdits.js";
import { jsonResponse, rejectUnexpectedRequest } from "../../../helpers/jsonResponse.js";
import { mutationFailureResponse } from "../../../helpers/sessionDetailFixture.js";
import { lastResendFailure } from "../helpers/resendFailureLog.js";

vi.mock(
  "../../../../../src/modules/debug/loggers/stateMachineLogger.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    logStateMachineDebug: vi.fn(),
  }),
);

function seedTurn(activeSession, turnScopeId) {
  const first = { messageUid: "m1", turnScopeId, role: RoleEnum.USER, content: "first" };
  const target = {
    presentationMessageId: "m2",
    turnScopeId,
    role: RoleEnum.ASSISTANT,
    content: "target",
  };
  activeSession.value.messages = [first, target];
  activeSession.value.rawMessages = [first, target];
  return { first, target };
}

describe("useChatEngine.resend failure rollback", () => {
  it("fails without delete/send fallback when replace-turn returns 404", async () => {
    logStateMachineDebug.mockClear();
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async () =>
      mutationFailureResponse({ status: 404, error: "replace-turn route missing" }),
    );
    const deleteSessionMessagesFromApi = vi.fn(rejectUnexpectedRequest);
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-404",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi },
    });
    const { first, target } = seedTurn(activeSession, "client-turn:replace-404");

    await expect(
      engine.resendMonotonicMessage(target, "edited after 404", NO_ATTACHMENT_EDITS),
    ).resolves.toBe(false);

    expect(lastResendFailure()).toMatchObject({
      replacementCommitted: false,
      errorMessage: "replace-turn route missing",
    });
    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
  });

  it("fails without fallback when the replace-turn request is rejected by the transport", async () => {
    logStateMachineDebug.mockClear();
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const deleteSessionMessagesFromApi = vi.fn(rejectUnexpectedRequest);
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-transport",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi },
    });
    const { first, target } = seedTurn(activeSession, "client-turn:replace-transport");

    await expect(
      engine.resendMonotonicMessage(target, "edited offline", NO_ATTACHMENT_EDITS),
    ).resolves.toBe(false);

    expect(lastResendFailure()).toMatchObject({
      replacementCommitted: false,
      errorMessage: "Failed to fetch",
    });
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
  });

  it("rolls back without retry or fallback when replace-turn reports a version conflict", async () => {
    logStateMachineDebug.mockClear();
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async () =>
      mutationFailureResponse({
        status: 409,
        error: "aggregate version conflict",
        errorCode: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT,
        currentVersion: 4,
      }),
    );
    const deleteSessionMessagesFromApi = vi.fn(rejectUnexpectedRequest);
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-replace-conflict",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi },
    });
    const { first, target } = seedTurn(activeSession, "client-turn:conflict");
    activeSession.value.messageCount = 2;
    activeSession.value.lastMessage = target;
    input.value = "draft before conflict";

    await expect(
      engine.resendMonotonicMessage(target, "edited conflict", NO_ATTACHMENT_EDITS),
    ).resolves.toBe(false);

    expect(lastResendFailure()).toMatchObject({
      replacementCommitted: false,
      errorMessage: "aggregate version conflict",
    });
    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value.messageCount).toBe(2);
    expect(activeSession.value.lastMessage).toStrictEqual(target);
    expect(input.value).toBe("draft before conflict");
  });

  it("rejects a replacement committed for another command", async () => {
    logStateMachineDebug.mockClear();
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, anchor }) => {
      const replacementUser = {
        messageUid: "replacement-user-wrong-command",
        userMessageId: "replacement-user-wrong-command",
        turnScopeId,
        role: RoleEnum.USER,
        content: "edited",
      };
      return makeTurnReplacementResponse({
        commandId: "another-resend-command",
        sessionId: "local-resend-command-mismatch",
        aggregateVersion: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
        replacementDialogProcessId: `dialog:${turnScopeId}`,
        messages: [replacementUser],
      });
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-command-mismatch",
      stream,
      deps: { replaceSessionTurnApi },
    });
    const { first, target } = seedTurn(activeSession, "turn-old");

    await expect(
      engine.resendMonotonicMessage(target, "edited", NO_ATTACHMENT_EDITS),
    ).resolves.toBe(false);

    expect(lastResendFailure()).toMatchObject({
      replacementCommitted: false,
      errorMessage: "invalid turn replacement commit: command_id_mismatch",
    });
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
  });

  it("rejects a committed detail that still materializes the replaced scope", async () => {
    logStateMachineDebug.mockClear();
    const staleFirst = {
      messageUid: "stale-user",
      turnScopeId: "scope-old",
      dialogProcessId: "dp-reused",
      role: RoleEnum.USER,
      content: "repeat",
    };
    const staleTarget = {
      messageUid: "stale-assistant",
      turnScopeId: "scope-old",
      dialogProcessId: "dp-reused",
      role: RoleEnum.ASSISTANT,
      content: "old answer",
    };
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn(rejectUnexpectedRequest);
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, commandId, anchor }) => {
      const replacementUser = {
        messageUid: "replacement-user",
        userMessageId: "replacement-user",
        turnScopeId,
        role: RoleEnum.USER,
        content: "repeat",
      };
      const body = makeTurnReplacementBody({
        commandId,
        sessionId: "local-resend-replace-reused-dialog",
        aggregateVersion: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
        replacementDialogProcessId: `dialog:${turnScopeId}`,
        messages: [staleFirst, staleTarget, replacementUser],
      });
      return jsonResponse({ ok: true, ...body });
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-reused-dialog",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi },
    });
    activeSession.value.messages = [{ ...staleFirst }, { ...staleTarget }];
    activeSession.value.rawMessages = [{ ...staleFirst }, { ...staleTarget }];

    await expect(
      engine.resendMonotonicMessage(staleTarget, "repeat", NO_ATTACHMENT_EDITS),
    ).resolves.toBe(false);

    expect(lastResendFailure()).toMatchObject({
      replacementCommitted: false,
      errorMessage: "session mutation response is invalid: replaced_scope_still_materialized",
    });
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages.map((message) => message.content)).toEqual([
      "repeat",
      "old answer",
    ]);
  });

  it("keeps the committed replacement when generation fails", async () => {
    logStateMachineDebug.mockClear();
    const stream = vi.fn(async () => {
      throw new Error("network failed");
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, commandId, anchor }) => {
      const replacementUser = {
        messageUid: "m-new",
        userMessageId: "m-new",
        turnScopeId,
        role: RoleEnum.USER,
        content: "edited retry text",
      };
      return makeTurnReplacementResponse({
        commandId,
        sessionId: "local-resend-send-fail",
        aggregateVersion: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
        replacementDialogProcessId: `dialog:${turnScopeId}`,
        messages: [replacementUser],
      });
    });
    const applySessionDetail = applyMainEntryMessages(() => activeSession);
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-send-fail",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const { first, target } = seedTurn(activeSession, "turn-send-fail");
    input.value = "draft before resend";

    await expect(
      engine.resendMonotonicMessage(target, "edited retry text", NO_ATTACHMENT_EDITS),
    ).resolves.toBe(false);

    expect(applySessionDetail).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages[0]).toEqual(
      expect.objectContaining({
        userMessageId: "m-new",
        role: RoleEnum.USER,
        content: "edited retry text",
      }),
    );
    expect(
      activeSession.value.messages.some((message) => message === first || message === target),
    ).toBe(false);
    expect(activeSession.value.messages.at(-1)).toEqual(
      expect.objectContaining({ role: RoleEnum.ASSISTANT, error: expect.any(String) }),
    );
    expect(activeSession.value.messages.at(-1)).not.toHaveProperty("pending");
    expect(input.value).toBe("edited retry text");
  });
});
