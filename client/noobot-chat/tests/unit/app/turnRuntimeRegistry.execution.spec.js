/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyExecutionSnapshot,
  applyExecutionTree,
  createTurnRuntimeRegistryState,
  selectExecutionChildren,
} from "../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry.js";

const execution = (executionId, overrides = {}) => ({
  executionId,
  executionKind: "agent",
  rootExecutionId: overrides.rootExecutionId || executionId,
  sessionId: `session-${executionId}`,
  turnScopeId: `turn-${executionId}`,
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
      applied: false, deduplicated: true, reason: "duplicate_execution",
    });
    expect(applyExecutionSnapshot(registry, execution("root", { state: "completed" }))).toMatchObject({
      applied: false, reason: "execution_sequence_conflict",
    });
    expect(registry.executions.root.state).toBe("processing");
  });

  it("rejects stale projections and accepts a newer revision", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("root", { revision: 2, sequence: 2 }));
    expect(applyExecutionSnapshot(registry, execution("root", { revision: 1, sequence: 99 })).reason).toBe("stale_execution");
    expect(applyExecutionSnapshot(registry, execution("root", { revision: 3, sequence: 3, state: "completed" })).applied).toBe(true);
    expect(registry.executions.root.state).toBe("completed");
  });

  it("moves a child between parents without retaining the old relation", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("parent-a"));
    applyExecutionSnapshot(registry, execution("parent-b"));
    applyExecutionSnapshot(registry, execution("child", { parentExecutionId: "parent-a", rootExecutionId: "parent-a" }));
    applyExecutionSnapshot(registry, execution("child", {
      parentExecutionId: "parent-b", rootExecutionId: "parent-b", revision: 2, sequence: 2,
    }));
    expect(selectExecutionChildren(registry, "parent-a")).toEqual([]);
    expect(selectExecutionChildren(registry, "parent-b").map((item) => item.executionId)).toEqual(["child"]);
  });

  it("atomically rejects an invalid tree before deleting an existing projection", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("root"));
    applyExecutionSnapshot(registry, execution("old-child", { parentExecutionId: "root", rootExecutionId: "root" }));
    const result = applyExecutionTree(registry, {
      rootExecutionId: "root",
      tree: { executions: { broken: { executionId: "broken", executionKind: "agent", rootExecutionId: "root" } } },
    });
    expect(result.reason).toBe("invalid_execution_tree");
    expect(registry.executions["old-child"]).toBeTruthy();
  });

  it("merges an unversioned tree without deleting newer local projections", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("root"));
    applyExecutionSnapshot(registry, execution("old-child", { parentExecutionId: "root", rootExecutionId: "root" }));
    applyExecutionSnapshot(registry, execution("other-root"));
    const nextChild = execution("next-child", { parentExecutionId: "root", rootExecutionId: "root" });
    const result = applyExecutionTree(registry, {
      rootExecutionId: "root",
      tree: { executions: { root: execution("root", { revision: 2, sequence: 2 }), "next-child": nextChild } },
    });
    expect(result.applied).toBe(true);
    expect(registry.executions["old-child"]).toBeTruthy();
    expect(registry.executions["other-root"]).toBeTruthy();
    expect(selectExecutionChildren(registry, "root").map((item) => item.executionId).sort()).toEqual(["next-child", "old-child"]);
  });

  it("only removes a projection through a newer versioned tombstone", () => {
    const registry = createTurnRuntimeRegistryState();
    applyExecutionSnapshot(registry, execution("root", { revision: 2, sequence: 2 }));
    applyExecutionSnapshot(registry, execution("child", {
      parentExecutionId: "root", rootExecutionId: "root", revision: 3, sequence: 5,
    }));
    applyExecutionTree(registry, {
      rootExecutionId: "root",
      removedExecutions: [{ executionId: "child", revision: 3, sequence: 5 }],
      tree: { executions: { root: execution("root", { revision: 2, sequence: 2 }) } },
    });
    expect(registry.executions.child).toBeTruthy();
    const result = applyExecutionTree(registry, {
      rootExecutionId: "root",
      removedExecutions: [{ executionId: "child", revision: 4, sequence: 6 }],
      tree: { executions: { root: execution("root", { revision: 2, sequence: 2 }) } },
    });
    expect(result.removedExecutionIds).toEqual(["child"]);
    expect(registry.executions.child).toBeUndefined();
  });

  it("indexes a workflow root and nested child agents", () => {
    const registry = createTurnRuntimeRegistryState();
    const workflow = execution("workflow-1", { executionKind: "workflow", sessionId: "", turnScopeId: "workflow-turn" });
    const child = execution("agent-1", { parentExecutionId: "workflow-1", rootExecutionId: "workflow-1" });
    const grandchild = execution("agent-2", { parentExecutionId: "agent-1", rootExecutionId: "workflow-1" });
    expect(applyExecutionTree(registry, {
      rootExecutionId: "workflow-1",
      tree: { executions: { "workflow-1": workflow, "agent-1": child, "agent-2": grandchild } },
    }).applied).toBe(true);
    expect(selectExecutionChildren(registry, "workflow-1").map((item) => item.executionId)).toEqual(["agent-1"]);
    expect(selectExecutionChildren(registry, "agent-1").map((item) => item.executionId)).toEqual(["agent-2"]);
  });
});
