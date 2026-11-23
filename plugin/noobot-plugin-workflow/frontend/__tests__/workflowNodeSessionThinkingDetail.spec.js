/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { encodeSessionPageSnapshotCursor } from "@noobot/session-protocol/message-read-budget";
import { fetchWorkflowNodeThinkingDetail } from "../runtime/workflowNodeSessionDetail.js";

describe("workflow node thinking detail cursor ownership", () => {
  it("rejects an ungranted cursor before transport and releases a granted cursor if the response drifts", async () => {
    const position = { after: 1, scope: "partition-snapshot" };
    const cursor = encodeSessionPageSnapshotCursor("retained", position);
    const identity = { sessionId: "child", dialogProcessId: "child-dialog", turnScopeId: "turn" };
    const getThinkingDetail = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        exists: true,
        ...identity,
        generation: 4,
        messageCount: 2,
        messages: [identity],
        nextCursor: null,
      }),
    }));
    const releaseThinkingDetail = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, released: true }),
    }));
    const scope = {
      userId: "user",
      sessionId: "root",
      nodeSessionId: identity.sessionId,
      routeDialogProcessId: "route-dialog",
      dialogProcessId: identity.dialogProcessId,
      turnScopeId: identity.turnScopeId,
      cursor,
    };
    const { userId, sessionId: rootSessionId, ...target } = scope;
    const request = {
      ...target,
      rootSessionId,
      props: { userId, workflowSessionService: { getThinkingDetail, releaseThinkingDetail } },
      translate: (key) => key,
      snapshot: { generation: 3, messageCount: 2, nextCursor: cursor },
    };
    await expect(
      fetchWorkflowNodeThinkingDetail({
        ...request,
        cursor: encodeSessionPageSnapshotCursor("foreign", position),
      }),
    ).rejects.toThrow(/previous thinking detail page/);
    expect(getThinkingDetail).not.toHaveBeenCalled();
    expect(releaseThinkingDetail).not.toHaveBeenCalled();

    await expect(fetchWorkflowNodeThinkingDetail(request)).rejects.toThrow(/snapshot facts/);
    expect(getThinkingDetail).toHaveBeenCalledTimes(1);
    expect(releaseThinkingDetail).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it.each([false, true])(
    "releases a rejected thinking page (release fails: %s)",
    async (releaseFails) => {
      const cursor = {
        after: 1,
        scope: JSON.stringify(["retained-snapshot", "partition-snapshot"]),
      };
      const releaseError = new Error("release transport failed");
      const releaseThinkingDetail = vi.fn(async () => {
        if (releaseFails) throw releaseError;
        return { ok: true, json: async () => ({ ok: true, released: true }) };
      });
      const props = {
        userId: "original-user",
        workflowSessionService: {
          async getThinkingDetail() {
            props.userId = "new-user";
            props.workflowSessionService = {};
            return { ok: true, json: async () => ({ ok: true, exists: true, nextCursor: cursor }) };
          },
          releaseThinkingDetail,
        },
      };
      const request = fetchWorkflowNodeThinkingDetail({
        props,
        translate: (key) => key,
        rootSessionId: "root",
        nodeSessionId: "child",
        routeDialogProcessId: "route-dialog",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      });
      if (releaseFails) {
        await expect(request).rejects.toMatchObject({
          name: "AggregateError",
          cause: expect.any(TypeError),
          errors: [expect.any(TypeError), releaseError],
        });
      } else {
        await expect(request).rejects.toBeInstanceOf(TypeError);
      }
      expect(releaseThinkingDetail).toHaveBeenCalledExactlyOnceWith({
        userId: "original-user",
        sessionId: "root",
        nodeSessionId: "child",
        routeDialogProcessId: "route-dialog",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
        cursor,
      });
    },
  );
});
