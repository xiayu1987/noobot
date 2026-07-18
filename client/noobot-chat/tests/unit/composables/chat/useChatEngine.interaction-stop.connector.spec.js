/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createHarness } from "./helpers/useChatEngineHarness";
import { StreamEventEnum, RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.interaction-stop: connector", () => {
  it("connector_status is informational: updates connector panel without interaction pending", async () => {
    const setPendingInteractionRequest = vi.fn();
    const submitInteractionResponse = vi.fn();
    const refreshSessionConnectorsAsync = vi.fn();
    const upsertConnectedConnectorInPanelState = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CONNECTOR_STATUS,
        data: {
          sessionId: "local-connector-status",
          dialogProcessId: "dp-connector-status",
          connectorType: "email",
          connectorName: "example_email",
          status: "connected",
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-connector-status",
          dialogProcessId: "dp-connector-status",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-connector-status",
              content: "ok",
            },
          ],
        },
      });
    });
    const { engine, activeSession, appendMessage } = createHarness({
      sessionId: "local-connector-status",
      stream,
      deps: {
        refreshSessionConnectorsAsync,
        connectorTypeSet: new Set(["email"]),
        upsertConnectedConnectorInPanelState,
        setPendingInteractionRequest,
        submitInteractionResponse,
      },
    });

    await engine.send();

    expect(upsertConnectedConnectorInPanelState).toHaveBeenCalledWith(activeSession.value, {
      connectorType: "email",
      connectorName: "example_email",
      status: "connected",
    });
    expect(refreshSessionConnectorsAsync).toHaveBeenCalledWith("local-connector-status");
    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(submitInteractionResponse).not.toHaveBeenCalled();
  });
});
