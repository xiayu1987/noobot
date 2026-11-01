/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  isSameWorkflowDrawerRoute,
  resolveCanonicalWorkflowNodeItem,
} from "../composables/useWorkflowNodeSessionViewer.js";

describe("workflow node session identity", () => {
  it("keeps the canonical node resolver available from the viewer entrypoint", () => {
    expect(
      resolveCanonicalWorkflowNodeItem(
        { nodeExecutionId: "node-a", rootSessionId: "root-session" },
        { value: [{ nodeExecutionId: "node-a", nodeSessionId: "child-session" }] },
      ),
    ).toEqual(
      expect.objectContaining({
        nodeExecutionId: "node-a",
        nodeSessionId: "child-session",
        rootSessionId: "root-session",
      }),
    );
  });

  it("recognizes only a fully matching workflow drawer route", () => {
    expect(
      isSameWorkflowDrawerRoute(
        { rootSessionId: "root", dialogProcessId: "dialog" },
        { rootSessionId: "root", dialogProcessId: "dialog" },
      ),
    ).toBe(true);
    expect(
      isSameWorkflowDrawerRoute(
        { rootSessionId: "root", dialogProcessId: "dialog" },
        { rootSessionId: "root", dialogProcessId: "other" },
      ),
    ).toBe(false);
  });
});
