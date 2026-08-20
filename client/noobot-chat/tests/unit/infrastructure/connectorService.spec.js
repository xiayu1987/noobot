/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createConnectorService } from "../../../src/infrastructure/api/connectors/connectorService.js";

const okResponse = (payload) => ({
  ok: true,
  json: async () => ({ ok: true, ...payload }),
});

describe("connectorService", () => {
  it("hydrates public connectors and the root Session selection", async () => {
    const session = { sessionId: "session-1" };
    const getSessionConnectorsApi = vi.fn(async () =>
      okResponse({
        sessionId: "root-1",
        connectors: [
          {
            connectorId: "con_db",
            name: "database",
            type: "database",
            subType: "postgres",
            status: "connected",
          },
        ],
        selectedConnectorIds: ["con_db"],
      }),
    );
    const service = createConnectorService({
      ensureConnected: () => true,
      getSessionConnectorsApi,
      putSessionConnectorSelectionApi: vi.fn(),
      userId: ref("alice"),
      authFetch: vi.fn(),
    });

    await service.refreshSessionConnectors({ sessionId: "session-1", sessions: [session] });

    expect(session.connectorPanelState).toEqual({
      rootSessionId: "root-1",
      connectors: [
        {
          connectorId: "con_db",
          name: "database",
          type: "database",
          subType: "postgres",
          status: "connected",
        },
      ],
      selectedConnectorIds: ["con_db"],
      updatedAt: expect.any(String),
    });
  });

  it("writes only normalized connector ids to the Session selection endpoint", async () => {
    const putSessionConnectorSelectionApi = vi.fn(async () =>
      okResponse({
        selectedConnectorIds: ["con_db", "con_mail"],
      }),
    );
    const activeSession = {
      sessionId: "session-1",
      connectorPanelState: { rootSessionId: "root-1", connectors: [] },
    };
    const service = createConnectorService({
      ensureConnected: () => true,
      getSessionConnectorsApi: vi.fn(),
      putSessionConnectorSelectionApi,
      userId: ref("alice"),
      authFetch: vi.fn(),
    });

    await service.updateSessionSelectedConnectors({
      activeSession,
      selectedConnectorIds: ["con_db", "con_db", "con_mail"],
    });

    expect(putSessionConnectorSelectionApi).toHaveBeenCalledWith(
      {
        userId: "alice",
        sessionId: "session-1",
        selectedConnectorIds: ["con_db", "con_mail"],
      },
      { fetcher: expect.any(Function) },
    );
    expect(activeSession.connectorPanelState.selectedConnectorIds).toEqual(["con_db", "con_mail"]);
  });
});
