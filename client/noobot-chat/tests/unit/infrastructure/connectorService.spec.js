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

  it("keeps a new Session selection as an explicit local creation draft", async () => {
    const putSessionConnectorSelectionApi = vi.fn();
    const activeSession = {
      sessionId: "local-1",
      isLocal: true,
      connectorPanelState: { connectors: [{ connectorId: "con_db" }] },
    };
    const service = createConnectorService({
      ensureConnected: () => true,
      getSessionConnectorsApi: vi.fn(),
      putSessionConnectorSelectionApi,
      userId: ref("alice"),
      authFetch: vi.fn(),
    });

    await expect(
      service.updateSessionSelectedConnectors({
        activeSession,
        selectedConnectorIds: ["con_db", "con_db"],
      }),
    ).resolves.toBe(true);

    expect(putSessionConnectorSelectionApi).not.toHaveBeenCalled();
    expect(activeSession.connectorPanelState).toMatchObject({
      rootSessionId: "local-1",
      selectedConnectorIds: ["con_db"],
    });
  });

  it("refreshes a new Session from the user catalog without replacing its local selection", async () => {
    let releaseCatalog;
    const listUserConnectorsApi = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseCatalog = () =>
            resolve(
              okResponse({
                connectors: [{ connectorId: "con_db", status: "connected" }],
              }),
            );
        }),
    );
    const activeSession = {
      sessionId: "local-1",
      isLocal: true,
      connectorPanelState: { connectors: [], selectedConnectorIds: [] },
    };
    const service = createConnectorService({
      ensureConnected: () => true,
      listUserConnectorsApi,
      getSessionConnectorsApi: vi.fn(),
      putSessionConnectorSelectionApi: vi.fn(),
      userId: ref("alice"),
      authFetch: vi.fn(),
    });

    const refresh = service.refreshSessionConnectors({
      sessionId: "local-1",
      sessions: [activeSession],
    });
    await vi.waitFor(() => expect(listUserConnectorsApi).toHaveBeenCalledOnce());
    await service.updateSessionSelectedConnectors({
      activeSession,
      selectedConnectorIds: ["con_db"],
    });
    releaseCatalog();
    await refresh;

    expect(listUserConnectorsApi).toHaveBeenCalledWith({
      userId: "alice",
      fetcher: expect.any(Function),
    });
    expect(activeSession.connectorPanelState).toMatchObject({
      rootSessionId: "local-1",
      connectors: [{ connectorId: "con_db", status: "connected" }],
      selectedConnectorIds: ["con_db"],
    });
  });

  it("exposes the authoritative selection write as a send barrier", async () => {
    let releaseSelection;
    const putSessionConnectorSelectionApi = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseSelection = () => resolve(okResponse({ selectedConnectorIds: ["con_db"] }));
        }),
    );
    const activeSession = {
      sessionId: "session-1",
      connectorPanelState: { connectors: [{ connectorId: "con_db" }] },
    };
    const service = createConnectorService({
      ensureConnected: () => true,
      getSessionConnectorsApi: vi.fn(),
      putSessionConnectorSelectionApi,
      userId: ref("alice"),
      authFetch: vi.fn(),
    });

    const update = service.updateSessionSelectedConnectors({
      activeSession,
      selectedConnectorIds: ["con_db"],
    });
    let barrierSettled = false;
    const barrier = service.waitForSessionConnectorState("session-1").then(() => {
      barrierSettled = true;
    });
    await vi.waitFor(() => expect(putSessionConnectorSelectionApi).toHaveBeenCalledOnce());
    expect(barrierSettled).toBe(false);

    releaseSelection();
    await Promise.all([update, barrier]);
    expect(activeSession.connectorPanelState.selectedConnectorIds).toEqual(["con_db"]);
  });

  it("serializes persisted Session refresh and selection writes", async () => {
    let releaseRefresh;
    const getSessionConnectorsApi = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseRefresh = () =>
            resolve(okResponse({ sessionId: "session-1", selectedConnectorIds: [] }));
        }),
    );
    const putSessionConnectorSelectionApi = vi.fn(async () =>
      okResponse({ selectedConnectorIds: ["con_db"] }),
    );
    const activeSession = {
      sessionId: "session-1",
      isLocal: false,
      connectorPanelState: { connectors: [{ connectorId: "con_db" }] },
    };
    const service = createConnectorService({
      ensureConnected: () => true,
      getSessionConnectorsApi,
      putSessionConnectorSelectionApi,
      userId: ref("alice"),
      authFetch: vi.fn(),
    });

    const refresh = service.refreshSessionConnectors({
      sessionId: "session-1",
      sessions: [activeSession],
    });
    await vi.waitFor(() => expect(getSessionConnectorsApi).toHaveBeenCalledOnce());
    const update = service.updateSessionSelectedConnectors({
      activeSession,
      selectedConnectorIds: ["con_db"],
    });
    expect(putSessionConnectorSelectionApi).not.toHaveBeenCalled();

    releaseRefresh();
    await Promise.all([refresh, update]);
    expect(putSessionConnectorSelectionApi).toHaveBeenCalledOnce();
    expect(activeSession.connectorPanelState.selectedConnectorIds).toEqual(["con_db"]);
  });
});
