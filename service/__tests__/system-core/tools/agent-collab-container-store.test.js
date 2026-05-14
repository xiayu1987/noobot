import test from "node:test";
import assert from "node:assert/strict";

import { createCollabContainerStore } from "../../../system-core/tools/workflow/agent-collab/collab-container-store.js";

test("collab-container-store: create + patch + status aggregation", () => {
  const runtime = {};
  const store = createCollabContainerStore({ runtime });

  const container = store.createChildAsyncResultContainer({
    parentSessionId: "11111111-1111-4111-8111-111111111111",
    parentDialogProcessId: "dp_parent_1",
    request: {
      sessionId: "22222222-2222-4222-8222-222222222222",
      taskName: "子任务A",
      taskContent: "完成A",
    },
  });

  assert.ok(container?.id);
  assert.equal(runtime.childAsyncResultContainers.length, 1);
  assert.equal(container.status, "running");

  store.patchContainerTaskAndStatus({
    container,
    sessionId: "22222222-2222-4222-8222-222222222222",
    patch: {
      status: "completed",
      endedAt: store.nowIso(),
      result: { answer: "ok" },
    },
  });

  assert.equal(container.status, "completed");
  assert.equal(container.tasks[0]?.status, "completed");

  const patchedTask = store.patchAsyncResultTask({
    containerId: container.id,
    sessionId: "22222222-2222-4222-8222-222222222222",
    patch: { attachmentId: "att_1", attachmentName: "subtask-a.md" },
  });
  assert.equal(patchedTask?.attachmentId, "att_1");
});

test("collab-container-store: status resolver honors failed > completed/stopped", () => {
  const runtime = {};
  const store = createCollabContainerStore({ runtime });

  assert.equal(store.updateContainerStatusByTasks({ tasks: [] }), "running");
  assert.equal(
    store.updateContainerStatusByTasks({
      tasks: [{ status: "completed" }, { status: "completed" }],
    }),
    "completed",
  );
  assert.equal(
    store.updateContainerStatusByTasks({
      tasks: [{ status: "running" }, { status: "stopped" }],
    }),
    "stopped",
  );
  assert.equal(
    store.updateContainerStatusByTasks({
      tasks: [{ status: "failed" }, { status: "completed" }],
    }),
    "failed",
  );
});
