/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  EXECUTION_TREE_WIRE_EVENT,
  deriveAgentExecutionId,
} from "@noobot/session-protocol/execution-lifecycle";
import { validateExecutionQueryPayload } from "@noobot/event-protocol/execution-query";
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

const applySnapshot = (registry, item) => applyExecutionSnapshot(registry, { execution: item });

describe("Execution Registry authoritative projections", () => {
  it("deduplicates identical coordinates and rejects conflicting facts", () => {
    const registry = createTurnRuntimeRegistryState();
    expect(applySnapshot(registry, execution("root")).applied).toBe(true);
    expect(applySnapshot(registry, execution("root"))).toMatchObject({
      applied: false,
      deduplicated: true,
      reason: "duplicate_execution",
    });
    expect(applySnapshot(registry, execution("root", { state: "completed" }))).toMatchObject({
      applied: false,
      reason: "execution_sequence_conflict",
    });
    expect(registry.executions[id("root")].state).toBe("processing");
  });

  it("rejects stale projections and accepts a newer revision", () => {
    const registry = createTurnRuntimeRegistryState();
    applySnapshot(registry, execution("root", { revision: 2, sequence: 2 }));
    expect(applySnapshot(registry, execution("root", { revision: 1, sequence: 99 })).reason).toBe(
      "stale_execution",
    );
    expect(
      applySnapshot(registry, execution("root", { revision: 3, sequence: 3, state: "completed" }))
        .applied,
    ).toBe(true);
    expect(registry.executions[id("root")].state).toBe("completed");
  });

  it("moves a child between parents without retaining the old relation", () => {
    const registry = createTurnRuntimeRegistryState();
    applySnapshot(registry, execution("parent-a"));
    applySnapshot(registry, execution("parent-b"));
    applySnapshot(
      registry,
      execution("child", { parentExecutionId: id("parent-a"), rootExecutionId: id("parent-a") }),
    );
    applySnapshot(
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

  it("leaves invalid trees to the execution query protocol", () => {
    const validation = validateExecutionQueryPayload(EXECUTION_TREE_WIRE_EVENT, {
      rootExecutionId: id("root"),
      tree: {
        executions: {
          broken: { executionId: "broken", executionKind: "agent", rootExecutionId: id("root") },
        },
      },
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.startsWith("tree.broken:"))).toBe(true);
  });

  it("merges an unversioned tree without deleting newer local projections", () => {
    const registry = createTurnRuntimeRegistryState();
    applySnapshot(registry, execution("root"));
    applySnapshot(
      registry,
      execution("old-child", { parentExecutionId: id("root"), rootExecutionId: id("root") }),
    );
    applySnapshot(registry, execution("other-root"));
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
