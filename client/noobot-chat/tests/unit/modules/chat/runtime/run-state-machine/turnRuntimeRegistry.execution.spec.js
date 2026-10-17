/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { deriveAgentExecutionId } from "@noobot/session-protocol/execution-lifecycle";
import {
  applyExecutionSnapshot,
  applyExecutionTree,
  createTurnRuntimeRegistryState,
  selectExecutionChildren,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

const id = (turnScopeId) => deriveAgentExecutionId({ turnScopeId });

const execution = (turnScopeId, overrides = {}) => ({
  executionId: id(turnScopeId),
  executionKind: "agent",
  rootExecutionId: id(turnScopeId),
  sessionId: `session-${turnScopeId}`,
  turnScopeId,
  revision: 1,
  sequence: 1,
  state: "processing",
  ...overrides,
});

describe("Execution Registry authoritative projections", () => {
  it("deduplicates identical coordinates and rejects conflicting facts", () => {
    const registry = createTurnRuntimeRegistryState();
    expect(applyExecutionSnapshot(registry, execution("root")).applied).toBe(true);
    expect(applyExecutionSnapshot(registry, execution("root"))).toMatchObject({
      applied: false,
      deduplicated: true,
      reason: "duplicate_execution",
    });
    expect(
      applyExecutionSnapshot(registry, execution("root", { state: "completed" })),
    ).toMatchObject({
      applied: false,
      reason: "execution_sequence_conflict",
    });
    expect(registry.executions[id("root")].state).toBe("processing");
  });

  it("rejects stale projections and accepts a newer revision", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("root", { revision: 2, sequence: 2 }));
    expect(
      applyExecutionSnapshot(registry, execution("root", { revision: 1, sequence: 99 })).reason,
    ).toBe("stale_execution");
    expect(
      applyExecutionSnapshot(
        registry,
        execution("root", { revision: 3, sequence: 3, state: "completed" }),
      ).applied,
    ).toBe(true);
    expect(registry.executions[id("root")].state).toBe("completed");
  });

  it("moves a child between parents without retaining the old relation", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("parent-a"));
    applyExecutionSnapshot(registry, execution("parent-b"));
    applyExecutionSnapshot(
      registry,
      execution("child", { parentExecutionId: id("parent-a"), rootExecutionId: id("parent-a") }),
    );
    applyExecutionSnapshot(
      registry,
      execution("child", {
        parentExecutionId: id("parent-b"),
        rootExecutionId: id("parent-b"),
        revision: 2,
        sequence: 2,
      }),
    );
    expect(selectExecutionChildren(registry, id("parent-a"))).toEqual([]);
    expect(
      selectExecutionChildren(registry, id("parent-b")).map((item) => item.executionId),
    ).toEqual([id("child")]);
  });

  it("atomically rejects an invalid tree before deleting an existing projection", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("root"));
    applyExecutionSnapshot(
      registry,
      execution("old-child", { parentExecutionId: id("root"), rootExecutionId: id("root") }),
    );
    const result = applyExecutionTree(registry, {
      rootExecutionId: id("root"),
      tree: {
        executions: {
          broken: { executionId: "broken", executionKind: "agent", rootExecutionId: id("root") },
        },
      },
    });
    expect(result.reason).toBe("invalid_execution_tree");
    expect(registry.executions[id("old-child")]).toBeTruthy();
  });

  it("merges an unversioned tree without deleting newer local projections", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("root"));
    applyExecutionSnapshot(
      registry,
      execution("old-child", { parentExecutionId: id("root"), rootExecutionId: id("root") }),
    );
    applyExecutionSnapshot(registry, execution("other-root"));
    const nextChild = execution("next-child", {
      parentExecutionId: id("root"),
      rootExecutionId: id("root"),
    });
    const result = applyExecutionTree(registry, {
      rootExecutionId: id("root"),
      tree: {
        executions: {
          [id("root")]: execution("root", { revision: 2, sequence: 2 }),
          [id("next-child")]: nextChild,
        },
      },
    });
    expect(result.applied).toBe(true);
    expect(registry.executions[id("old-child")]).toBeTruthy();
    expect(registry.executions[id("other-root")]).toBeTruthy();
    expect(
      selectExecutionChildren(registry, id("root"))
        .map((item) => item.executionId)
        .sort(),
    ).toEqual([id("next-child"), id("old-child")].sort());
  });

  it("only removes a projection through a newer versioned tombstone", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("root", { revision: 2, sequence: 2 }));
    applyExecutionSnapshot(
      registry,
      execution("child", {
        parentExecutionId: id("root"),
        rootExecutionId: id("root"),
        revision: 3,
        sequence: 5,
      }),
    );
    applyExecutionTree(registry, {
      rootExecutionId: id("root"),
      removedExecutions: [{ executionId: id("child"), revision: 3, sequence: 5 }],
      tree: { executions: { [id("root")]: execution("root", { revision: 2, sequence: 2 }) } },
    });
    expect(registry.executions[id("child")]).toBeTruthy();
    const result = applyExecutionTree(registry, {
      rootExecutionId: id("root"),
      removedExecutions: [{ executionId: id("child"), revision: 4, sequence: 6 }],
      tree: { executions: { [id("root")]: execution("root", { revision: 2, sequence: 2 }) } },
    });
    expect(result.removedExecutionIds).toEqual([id("child")]);
    expect(registry.executions[id("child")]).toBeUndefined();
  });

  it("indexes a workflow root and nested child agents", () => {
    const registry = createTurnRuntimeRegistryState();
    const workflow = execution("workflow-turn", {
      executionId: "workflow-1",
      rootExecutionId: "workflow-1",
      executionKind: "workflow",
      sessionId: "",
    });
    const child = execution("agent-1", {
      parentExecutionId: "workflow-1",
      rootExecutionId: "workflow-1",
    });
    const grandchild = execution("agent-2", {
      parentExecutionId: id("agent-1"),
      rootExecutionId: "workflow-1",
    });
    expect(
      applyExecutionTree(registry, {
        rootExecutionId: "workflow-1",
        tree: {
          executions: {
            "workflow-1": workflow,
            [id("agent-1")]: child,
            [id("agent-2")]: grandchild,
          },
        },
      }).applied,
    ).toBe(true);
    expect(selectExecutionChildren(registry, "workflow-1").map((item) => item.executionId)).toEqual(
      [id("agent-1")],
    );
    expect(
      selectExecutionChildren(registry, id("agent-1")).map((item) => item.executionId),
    ).toEqual([id("agent-2")]);
  });
});
