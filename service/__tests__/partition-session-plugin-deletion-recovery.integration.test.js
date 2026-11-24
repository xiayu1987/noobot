/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { resolvePluginDataRelativePath } from "@noobot/workspace-protocol";
import {
  SESSION_DELETION_STAGE,
  sessionBranchDeletionKey,
} from "@noobot/workspace-protocol/session-tombstone";
import { createPluginServicePorts } from "../services/plugin-service-ports.js";
import { createServicePluginHost } from "../services/service-plugin-host.js";
import {
  createPartitionBotFixture,
  firstSend,
  identity,
} from "./partition-bot-assembly.test-helpers.js";
import express, { registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";

async function createRun(runs, runId, manifest) {
  const dir = join(runs, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, "harness-run.json"), JSON.stringify(manifest));
  await fs.writeFile(join(dir, "residue"), runId);
}

test("HTTP replays real Harness cleanup after partial removal and then an unconfirmed success", async (t) => {
  const { service, access } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const { userId, sessionId } = identity;
  const retainedId = "retained";
  await bot.session.applyTurnLifecycleEvent(firstSend());
  await bot.session.applyTurnLifecycleEvent(firstSend({ ...identity, sessionId: retainedId }));
  const runs = join(bot.getWorkspacePath(userId), resolvePluginDataRelativePath("harness", "runs"));
  await createRun(runs, "doomed-run", { sessionId: "child", parentSessionId: sessionId });
  await createRun(runs, "retained-run", { sessionId: retainedId, parentSessionId: "" });

  const app = express();
  app.use(express.json());
  const pluginHost = createServicePluginHost();
  t.after(() => pluginHost.dispose());
  const translateText = (key) => key;
  await pluginHost.registerServiceRoutes(app, {
    runBotOperation: access.runOperation,
    ports: createPluginServicePorts({ bot: access, translateText }),
    enforceUserScopeParam: (_req, _res, next) => next(),
    translateText,
  });
  registerSessionRoutes(app, {
    bot: access,
    runBotOperation: access.runOperation,
    pluginHost,
    translateText,
  });

  const remove = fs.rm.bind(fs);
  let partialRemoval;
  const fault = t.mock.method(fs, "rm", async (target, options) => {
    if (dirname(target) === runs && options?.recursive && target !== join(runs, "retained-run")) {
      await fs.unlink(join(target, "harness-run.json"));
      partialRemoval = target;
      throw Object.assign(new Error("injected partial Harness removal"), { code: "EIO" });
    }
    return remove(target, options);
  });
  await withTestServer(app, async (baseUrl) => {
    const url = `${baseUrl}/internal/session/${userId}/${sessionId}`;
    try {
      const manifestPath = join(runs, "doomed-run", "harness-run.json");
      await fs.unlink(manifestPath);
      for (const raw of [undefined, JSON.stringify({ parentSessionId: sessionId })]) {
        if (raw !== undefined) await fs.writeFile(manifestPath, raw);
        const rejected = await fetch(url, { method: "DELETE" });
        const failure = await rejected.json();
        assert.equal(rejected.status, 500, JSON.stringify(failure));
        assert.equal(failure.errorCode, "HOOK_EXECUTION_FAILED");
        const pending =
          await bot.sessionRuntime.repositories.sessionRepository.readSessionBranchDeletion(
            userId,
            sessionBranchDeletionKey([sessionId]),
          );
        assert.equal(pending.nextStage, SESSION_DELETION_STAGE.PLUGINS);
        assert.equal(await fs.readFile(join(runs, "doomed-run", "residue"), "utf8"), "doomed-run");
        assert.equal(partialRemoval, undefined);
        if (raw !== undefined) assert.equal(await fs.readFile(manifestPath, "utf8"), raw);
      }
      await fs.writeFile(
        manifestPath,
        JSON.stringify({ sessionId: "child", parentSessionId: sessionId }),
      );
      const first = await fetch(url, { method: "DELETE" });
      const failure = await first.json();
      assert.equal(first.status, 500, JSON.stringify(failure));
      assert.ok(partialRemoval, JSON.stringify(failure));
      await assert.rejects(fs.stat(join(partialRemoval, "harness-run.json")), { code: "ENOENT" });
      await fs.stat(join(partialRemoval, "residue"));
    } finally {
      fault.mock.restore();
    }
    const { bot: reopened } = await service.rebuildRuntimeConfig();
    const overlapping = await fetch(`${baseUrl}/internal/sessions/${userId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds: [retainedId, sessionId] }),
    });
    assert.equal((await overlapping.json()).errorCode, "SESSION_DELETED");
    assert.deepEqual(await reopened.session.listSessionIds({ userId }), [retainedId]);

    const repo = reopened.sessionRuntime.repositories.sessionRepository;
    const advance = repo.advanceSessionBranchDeletion.bind(repo);
    let checkpointReached = false;
    t.mock.method(repo, "advanceSessionBranchDeletion", async (user, key, completedStage) => {
      if (completedStage === SESSION_DELETION_STAGE.PLUGINS) {
        checkpointReached = true;
        throw new Error("injected failure before plugin checkpoint");
      }
      return advance(user, key, completedStage);
    });
    const interrupted = await fetch(url, { method: "DELETE" });
    const failure = await interrupted.json();
    assert.equal(interrupted.status, 500, JSON.stringify(failure));
    assert.equal(checkpointReached, true, JSON.stringify(failure));
    assert.deepEqual(await fs.readdir(runs), ["retained-run"]);

    await service.rebuildRuntimeConfig();
    const retry = await fetch(url, { method: "DELETE" });
    const payload = await retry.json();
    assert.equal(retry.status, 200, JSON.stringify(payload));
    assert.deepEqual(payload.deletedSessionIds, [sessionId]);
    assert.deepEqual(await fs.readdir(runs), ["retained-run"]);
  });
});

test("HTTP serializes duplicate deletion until a timed-out plugin writer exits", async (t) => {
  const { service, access } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  const { userId, sessionId } = identity;
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const hooks = createHookManager();
  const point = HOOK_POINT.SERVICE.AFTER_SESSION_DELETE;
  const timeout = Promise.withResolvers();
  const finishWrite = Promise.withResolvers();
  const secondRequestAtLock = Promise.withResolvers();
  const events = [];
  hooks.on(
    point,
    async (_context, { signal }) => {
      if (events.length) {
        events.push("retry started");
        return;
      }
      events.push("first started");
      signal.addEventListener("abort", () => timeout.resolve(signal.reason), { once: true });
      await finishWrite.promise;
      events.push("first exited");
    },
    { id: "test.writer", timeoutMs: 10 },
  );
  const repo = bot.sessionRuntime.repositories.sessionRepository;
  const withDeletion = repo.withSessionBranchDeletion.bind(repo);
  let attempts = 0;
  t.mock.method(repo, "withSessionBranchDeletion", (...args) => {
    if (++attempts === 2) secondRequestAtLock.resolve();
    return withDeletion(...args);
  });
  const app = express();
  registerSessionRoutes(app, {
    bot: access,
    runBotOperation: access.runOperation,
    pluginHost: {
      listSessionDeletionHandlers: () => ["test.writer"],
      emitAfterSessionDelete: ({ pluginHandlerIds }) =>
        hooks.emit(point, {}, { handlerIds: pluginHandlerIds }),
    },
    translateText: (key) => key,
  });
  await withTestServer(app, async (baseUrl) => {
    const removeSession = () =>
      fetch(`${baseUrl}/internal/session/${userId}/${sessionId}`, { method: "DELETE" });
    const first = removeSession();
    let retry;
    try {
      assert.equal((await Promise.race([timeout.promise, first])).code, "HOOK_TIMEOUT");
      retry = removeSession();
      await Promise.race([secondRequestAtLock.promise, retry]);
      await setImmediate();
      assert.deepEqual(events, ["first started"]);
    } finally {
      finishWrite.resolve();
    }
    const response = await first;
    assert.equal(response.status, 500);
    assert.equal((await response.json()).errorCode, "HOOK_EXECUTION_FAILED");
    const repeated = await retry;
    assert.equal(repeated.status, 200);
    assert.deepEqual((await repeated.json()).deletedSessionIds, [sessionId]);
    assert.deepEqual(events, ["first started", "first exited", "retry started"]);
  });
});

test("HTTP replays the recorded plugin batch from its first handler after partial success", async (t) => {
  const { service, access } = await createPartitionBotFixture(t);
  const { bot } = await service.rebuildRuntimeConfig();
  await bot.session.applyTurnLifecycleEvent(firstSend());
  const { userId, sessionId } = identity;
  const hooks = createHookManager();
  const point = HOOK_POINT.SERVICE.AFTER_SESSION_DELETE;
  const handlerIds = ["test.first", "test.second"];
  const calls = [];
  const firstTarget = join(bot.getWorkspacePath(userId), "first-plugin-target");
  await fs.writeFile(firstTarget, "plugin fact");
  hooks.on(
    point,
    async ({ deletionKey }) => {
      calls.push(["first", deletionKey]);
      await fs.rm(firstTarget, { force: true });
    },
    { id: handlerIds[0] },
  );
  hooks.on(
    point,
    ({ deletionKey }) => {
      calls.push(["second", deletionKey]);
      if (calls.length === 2) throw new Error("second plugin failed after the first succeeded");
    },
    { id: handlerIds[1] },
  );
  let plans = 0;
  const app = express();
  registerSessionRoutes(app, {
    bot: access,
    runBotOperation: access.runOperation,
    pluginHost: {
      listSessionDeletionHandlers: () => {
        plans += 1;
        return handlerIds;
      },
      emitAfterSessionDelete: ({ deletedSessionIds, deletionKey, pluginHandlerIds }) => {
        assert.deepEqual(pluginHandlerIds, handlerIds);
        assert.deepEqual(deletedSessionIds, [sessionId]);
        return hooks.emit(
          point,
          { deletedSessionIds, deletionKey },
          { handlerIds: pluginHandlerIds },
        );
      },
    },
    translateText: (key) => key,
  });
  await withTestServer(app, async (baseUrl) => {
    const remove = () =>
      fetch(`${baseUrl}/internal/session/${userId}/${sessionId}`, { method: "DELETE" });
    const failed = await remove();
    assert.equal(failed.status, 500);
    assert.equal((await failed.json()).errorCode, "HOOK_EXECUTION_FAILED");
    assert.deepEqual(
      calls.map(([handler]) => handler),
      ["first", "second"],
    );
    await assert.rejects(fs.stat(firstTarget), { code: "ENOENT" });
    await service.rebuildRuntimeConfig();
    const retried = await remove();
    assert.equal(retried.status, 200);
    assert.deepEqual(await retried.json(), { ok: true, deletedSessionIds: [sessionId] });
    assert.equal((await remove()).status, 200);
    assert.equal(plans, 1);
    assert.deepEqual(
      calls.map(([handler]) => handler),
      ["first", "second", "first", "second"],
    );
    assert.equal(new Set(calls.map(([, key]) => key)).size, 1);
    assert.ok(calls[0][1]);
  });
});
