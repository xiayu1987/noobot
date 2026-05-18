import test from "node:test";
import assert from "node:assert/strict";

import {
  createHookManager,
  runRuntimeHook,
  resolveRuntimeHookManager,
  withHookRuntimeMeta,
} from "../../../src/system-core/hook/index.js";

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("hook manager runs hooks by priority (high -> low)", async () => {
  const manager = createHookManager();
  const order = [];

  manager.on("p", async () => order.push("low"), { priority: 1 });
  manager.on("p", async () => order.push("high"), { priority: 10 });

  const result = await manager.emit("p", {});
  assert.deepEqual(order, ["high", "low"]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.results.length, 2);
});

test("hook manager once hook only runs once", async () => {
  const manager = createHookManager();
  let count = 0;

  manager.once("once_point", async () => {
    count += 1;
  });

  await manager.emit("once_point", {});
  await manager.emit("once_point", {});

  assert.equal(count, 1);
  assert.equal(manager.list("once_point").length, 0);
});

test("hook manager off/remove works (including disposer)", async () => {
  const manager = createHookManager();
  let count = 0;

  const dispose = manager.on(
    "off_point",
    async () => {
      count += 1;
    },
    { id: "hook_1" },
  );
  const removedById = manager.off("off_point", "hook_1");
  assert.equal(removedById, true);

  await manager.emit("off_point", {});
  assert.equal(count, 0);

  const dispose2 = manager.on("off_point", async () => {
    count += 1;
  });
  dispose2();
  await manager.emit("off_point", {});
  assert.equal(count, 0);

  // no-op disposer should not throw
  dispose();
});

test("hook manager timeout returns hook error and calls onError", async () => {
  const errors = [];
  const manager = createHookManager({
    defaultTimeoutMs: 20,
    onError: (payload = {}) => errors.push(payload),
  });

  manager.on("timeout_point", async () => {
    await sleep(60);
  });

  const result = await manager.emit("timeout_point", {});
  assert.equal(result.errors.length, 1);
  assert.equal(result.results[0]?.ok, false);
  assert.equal(result.results[0]?.error?.code, "HOOK_TIMEOUT");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.error?.code, "HOOK_TIMEOUT");
});

test("hook manager supports parallel emit", async () => {
  const manager = createHookManager();
  const order = [];

  manager.on("parallel_point", async () => {
    await sleep(50);
    order.push("slow");
  });
  manager.on("parallel_point", async () => {
    await sleep(10);
    order.push("fast");
  });

  const startedAt = Date.now();
  const result = await manager.emit("parallel_point", {}, { parallel: true });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.errors.length, 0);
  assert.equal(result.results.length, 2);
  assert.ok(elapsed < 90);
  assert.deepEqual(order, ["fast", "slow"]);
});

test("runRuntimeHook resolves manager, executes, and emits hook_start/hook_end", async () => {
  const manager = createHookManager();
  const events = [];
  const eventListener = {
    onEvent(evt = {}) {
      events.push(evt);
    },
  };
  const runtime = {
    hooks: {
      manager,
    },
  };
  let called = false;
  manager.on("runtime_point", async (ctx = {}) => {
    called = true;
    ctx.mutated = true;
  });

  const resolved = resolveRuntimeHookManager(runtime);
  assert.equal(resolved, manager);

  const context = { value: 1 };
  const result = await runRuntimeHook({
    runtime,
    point: "runtime_point",
    context,
    eventListener,
  });

  assert.equal(result.executed, true);
  assert.equal(called, true);
  assert.equal(context.mutated, true);
  assert.equal(result.errors.length, 0);
  assert.equal(events[0]?.event, "hook_start");
  assert.equal(events[1]?.event, "hook_end");
});

test("runRuntimeHook returns executed=false when no manager exists", async () => {
  const runtime = {};
  const result = await runRuntimeHook({
    runtime,
    point: "missing_manager_point",
    context: { a: 1 },
  });
  assert.equal(result.executed, false);
  assert.equal(result.errors.length, 0);
});

test("runRuntimeHook handles runner throw and emits hook_error", async () => {
  const events = [];
  const eventListener = {
    onEvent(evt = {}) {
      events.push(evt);
    },
  };
  const runtime = {
    hookManager: {
      async emit() {
        throw new Error("runner exploded");
      },
    },
  };

  const result = await runRuntimeHook({
    runtime,
    point: "explode_point",
    context: { x: 1 },
    eventListener,
  });

  assert.equal(result.executed, true);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.message, "runner exploded");
  assert.equal(events[0]?.event, "hook_start");
  assert.equal(events[1]?.event, "hook_error");
});

test("withHookRuntimeMeta merges runtime identifiers into context", () => {
  const context = withHookRuntimeMeta(
    {
      userId: "u_fallback",
      systemRuntime: {
        userId: "u1",
        sessionId: "s1",
        parentSessionId: "p1",
        dialogProcessId: "d1",
        caller: "user",
      },
    },
    { phase: "x" },
  );
  assert.deepEqual(context, {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "p1",
    dialogProcessId: "d1",
    caller: "user",
    phase: "x",
  });
});
