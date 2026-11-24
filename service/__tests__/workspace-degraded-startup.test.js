/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeMessageContentPage } from "@noobot/session-protocol/message-read-budget";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_VERSION,
  WORKSPACE_ROOT_LAYOUT,
} from "@noobot/workspace-protocol";
import { createDefaultStartupContext } from "../services/startup-context-service.js";
import { createSessionFacade } from "noobot-agent/session";
import { createConfiguredSessionRuntime } from "../bootstrap/create-app-dependencies.js";
import { listQuarantinedUnits } from "../../agent/src/workspace-lifecycle/migration-quarantine.js";
import {
  acquireWorkspaceStorageLock,
  openStartupWorkspaceStorage,
} from "noobot-agent/workspace-session-storage";
import { initializeUserWorkspace } from "../../agent/__tests__/helpers/user-workspace.js";
import { committedAt, firstSend } from "./partition-bot-assembly.test-helpers.js";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const prefix = "service.startup.";

async function waitForStartup({ child, eventFile, signal }) {
  while (!signal.aborted) {
    const text = await fs.readFile(eventFile, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    });
    const events = text
      .split("\n")
      .slice(0, -1)
      .map(JSON.parse)
      .filter(({ process }) => process?.pid === child.pid);
    const failed = events.find(({ event }) => event === `${prefix}failed`);
    assert.equal(failed, undefined, JSON.stringify(failed?.data));
    assert.equal(child.exitCode, null, "service exited before listening");
    const listen = events.find(({ event }) => event === `${prefix}httpServer.listen.started`);
    if (listen) return { events, port: listen.data.port };
    await delay(50, undefined, { signal });
  }
  signal.throwIfAborted();
}

test("startup with a relative workspace root permits a healthy user's login", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-degraded-startup-"));
  const workspace = path.join(root, "workspace");
  const config = path.join(root, "global.json");
  const startup = path.join(root, "startup.json");
  const env = {
    ...process.env,
    NOOBOT_WORKSPACE_ROOT: workspace,
    NOOBOT_GLOBAL_CONFIG_PATH: config,
  };
  const layout = path.join(workspace, "broken", WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  const connectCode = "startup-test-code";
  const invalidLayout = "not valid JSON\n";
  const signal = AbortSignal.timeout(20000);
  let child;
  let closed;
  try {
    await fs.mkdir(path.dirname(layout), { recursive: true });
    await fs.writeFile(layout, invalidLayout);
    await fs.writeFile(
      path.join(workspace, WORKSPACE_ROOT_LAYOUT.USERS_FILE),
      JSON.stringify({ users: [{ userId: "broken", connectCode }] }),
    );
    const { partitionSessionStorage } = JSON.parse(
      await fs.readFile(new URL("../config/global.config.example.json", import.meta.url), "utf8"),
    );
    await fs.writeFile(
      config,
      JSON.stringify({
        workspace_root: path.relative(cwd, workspace),
        partitionSessionStorage,
        super_admin: { user_id: "healthy", connect_code: connectCode },
      }),
    );
    await fs.writeFile(
      startup,
      JSON.stringify({
        ...createDefaultStartupContext({ cwd, env }),
        service: { host: "127.0.0.1", port: 0, origin: "" },
      }),
    );
    child = spawn(process.execPath, ["app.js", "--startup-context", startup], {
      cwd,
      env,
      stdio: "ignore",
    });
    const spawnFailure = new Promise((_, reject) => child.once("error", reject));
    closed = new Promise((resolve) => child.once("close", resolve));
    const { events, port } = await Promise.race([
      spawnFailure,
      waitForStartup({
        child,
        eventFile: path.join(workspace, "system/runtime/events/startup/service/state.jsonl"),
        signal,
      }),
    ]);
    const preparation = events.find(
      ({ event }) => event === `${prefix}workspacePreparation.failed`,
    );
    assert.equal(preparation?.data.userCount, 2);
    assert.deepEqual(
      preparation.data.failures.map(({ userId, code }) => ({ userId, code })),
      [{ userId: "broken", code: "WORKSPACE_LAYOUT_STATE_INVALID" }],
    );
    assert.equal(await fs.readFile(layout, "utf8"), invalidLayout);
    const origin = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${origin}/health`, { signal })).json(), { ok: true });
    const login = await fetch(`${origin}/internal/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "healthy", connectCode }),
      signal,
    });
    assert.equal(login.status, 200);
    const { apiKey } = await login.json();
    assert.ok(apiKey);
    const headers = { "x-api-key": apiKey };
    const assertWorkspaceBlocked = async () => {
      const blocked = await fetch(`${origin}/internal/session/broken/session`, { headers, signal });
      assert.equal(blocked.status, 503);
      assert.equal((await blocked.json()).errorCode, "WORKSPACE_MAINTENANCE");
    };
    await assertWorkspaceBlocked();
    const rebuilt = await fetch(`${origin}/internal/admin/config-params`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ values: {}, descriptions: {} }),
      signal,
    });
    assert.equal(rebuilt.status, 200, JSON.stringify(await rebuilt.json()));
    await assertWorkspaceBlocked();
  } finally {
    child?.kill("SIGTERM");
    if (
      closed &&
      !(await Promise.race([closed.then(() => true), delay(3000, false, { ref: false })]))
    ) {
      child.kill("SIGKILL");
      await closed;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("startup isolates old session storage and keeps the healthy journal readable across restart", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-startup-partition-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, "workspace");
  const config = path.join(root, "global.json");
  const startup = path.join(root, "startup.json");
  const env = {
    ...process.env,
    NOOBOT_WORKSPACE_ROOT: workspaceRoot,
    NOOBOT_GLOBAL_CONFIG_PATH: config,
  };
  const { partitionSessionStorage } = JSON.parse(
    await fs.readFile(new URL("../config/global.config.example.json", import.meta.url), "utf8"),
  );
  const userId = "owner";
  const connectCode = "startup-migration-test";
  const sessionId = "healthy-session";
  await fs.writeFile(
    config,
    JSON.stringify({
      workspace_root: workspaceRoot,
      partitionSessionStorage,
      super_admin: { user_id: userId, connect_code: connectCode },
    }),
  );
  await fs.writeFile(
    startup,
    JSON.stringify({
      ...createDefaultStartupContext({ cwd, env }),
      service: { host: "127.0.0.1", port: 0, origin: "" },
    }),
  );
  const userWorkspace = await initializeUserWorkspace(workspaceRoot, userId);
  const legacyPath = path.join(WORKSPACE_LAYOUT.SESSION_DIR, "legacy-session");
  const legacyDir = path.join(userWorkspace, legacyPath);
  const oldHead = "old immutable head bytes";
  await fs.mkdir(legacyDir, { recursive: true });
  await fs.writeFile(path.join(legacyDir, "head.json"), oldHead);
  const predecessor = createConfiguredSessionRuntime(
    { workspaceRoot, partitionSessionStorage },
    {
      now: () => committedAt,
      attachmentService: { ingest() {} },
      scopedSessionRoots: [WORKSPACE_LAYOUT.AGENT_SESSION_DIR],
    },
  );
  try {
    await createSessionFacade(predecessor).applyTurnLifecycleEvent(
      firstSend({
        userId,
        sessionId,
        persistenceScope: null,
      }),
    );
  } finally {
    await predecessor.close();
  }
  const eventFile = path.join(workspaceRoot, "system/runtime/events/startup/service/state.jsonl");
  const layoutFile = path.join(userWorkspace, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  await fs.writeFile(layoutFile, JSON.stringify({ version: 45 }));
  let firstQuarantine;
  for (const restarting of [false, true]) {
    const signal = AbortSignal.timeout(20000);
    const child = spawn(process.execPath, ["app.js", "--startup-context", startup], {
      cwd,
      env,
      stdio: "ignore",
    });
    const closed = new Promise((resolve) => child.once("close", resolve));
    try {
      const { events, port } = await waitForStartup({ child, eventFile, signal });
      const completed = `${prefix}workspacePreparation.completed`;
      const failed = `${prefix}workspacePreparation.failed`;
      const preparations = events.filter(({ event }) => event === completed || event === failed);
      assert.deepEqual(
        preparations.map(({ event }) => event),
        [restarting ? completed : failed],
      );
      const { recoveredTurnCount, failures } = preparations[0].data;
      assert.equal(recoveredTurnCount, restarting ? 0 : 1);
      assert.equal(JSON.parse(await fs.readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
      const records = await listQuarantinedUnits({ base: userWorkspace });
      assert.equal(records.length, 1);
      const [record] = records;
      assert.equal(record.path, legacyPath);
      assert.equal(record.error.code, "SESSION_STORAGE_FORMAT_UNSUPPORTED");
      assert.equal(
        await fs.readFile(path.join(userWorkspace, record.quarantinePath, "head.json"), "utf8"),
        oldHead,
      );
      await assert.rejects(fs.stat(legacyDir), { code: "ENOENT" });
      if (restarting) {
        assert.deepEqual(record, firstQuarantine);
        assert.deepEqual(failures, []);
      } else {
        firstQuarantine = record;
        assert.deepEqual(
          failures.map(({ userId, path, quarantinePath, code }) => ({
            userId,
            path,
            quarantinePath,
            code,
          })),
          [
            {
              userId,
              path: legacyPath,
              quarantinePath: record.quarantinePath,
              code: record.error.code,
            },
          ],
        );
      }
      const origin = `http://127.0.0.1:${port}`;
      const login = await fetch(`${origin}/internal/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, connectCode }),
        signal,
      });
      assert.equal(login.status, 200);
      const headers = {
        "content-type": "application/json",
        "x-api-key": (await login.json()).apiKey,
      };
      const quarantineUrl = `${origin}/internal/sessions/${userId}/quarantine`;
      const listQuarantine = async () => {
        const response = await fetch(quarantineUrl, { headers, signal });
        const body = await response.json();
        assert.equal(response.status, 200, body.error);
        return body.sessions;
      };
      const [quarantined] = await listQuarantine();
      assert.equal(quarantined.sessionId, "legacy-session");
      assert.equal(quarantined.quarantinePath, record.quarantinePath);
      assert.equal(quarantined.status, "unsupported-format");
      if (restarting) {
        const deleteUrl = `${quarantineUrl}/${quarantined.id}`;
        const unauthorized = await fetch(deleteUrl, { method: "DELETE", signal });
        assert.equal(unauthorized.status, 401);
        for (const attempt of [0, 1]) {
          const deleted = await fetch(deleteUrl, { method: "DELETE", headers, signal });
          assert.equal(deleted.status, 200, `delete attempt ${attempt}`);
        }
        assert.deepEqual(await listQuarantine(), []);
        await assert.rejects(fs.stat(path.join(userWorkspace, record.quarantinePath)), {
          code: "ENOENT",
        });
        assert.deepEqual(await listQuarantinedUnits({ base: userWorkspace }), []);
      }
      const response = await fetch(
        `${origin}/internal/session/${userId}/${sessionId}/detail-start`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            direction: "backward",
            cursor: null,
            limit: 10,
            maxBytes: 65536,
            terminalLimit: 10,
            reconcileTurnScopeIds: [],
          }),
          signal,
        },
      );
      const detail = await response.json();
      assert.equal(response.status, 200, detail.error);
      assert.equal(detail.page.sessionId, sessionId);
      const row = detail.page.messages.find(({ role }) => role === "user");
      assert.ok(row);
      assert.equal(Object.hasOwn(row, "content"), false);
      const selection = {
        messageUid: row.messageUid,
        expectedContentReference: row.contentReference,
        byteOffset: 0,
        maxBytes: row.contentBytes,
      };
      const bodyResponse = await fetch(
        `${origin}/internal/session/${userId}/${sessionId}/message-content-page`,
        { method: "POST", headers, body: JSON.stringify(selection), signal },
      );
      const body = await bodyResponse.json();
      assert.equal(bodyResponse.status, 200, body.error);
      const { bytes } = decodeMessageContentPage(body.page, selection, row.contentBytes);
      assert.equal(JSON.parse(new TextDecoder().decode(bytes)), "分区 Bot input");
      await assert.rejects(
        acquireWorkspaceStorageLock(workspaceRoot, {
          shared: false,
          signal: AbortSignal.timeout(100),
        }),
        { name: "TimeoutError" },
      );
    } finally {
      child.kill("SIGTERM");
      if (!(await Promise.race([closed.then(() => true), delay(3000, false, { ref: false })]))) {
        child.kill("SIGKILL");
        await closed;
      }
    }
  }
});

test("startup migration restores its shared lock after failure and releases it on cancellation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-startup-storage-lock-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, "workspace");
  const controller = new AbortController();
  const storage = await openStartupWorkspaceStorage(workspaceRoot, { signal: controller.signal });
  try {
    const failure = new Error("migration failed");
    await assert.rejects(
      storage.withExclusive(async () => {
        throw failure;
      }),
      failure,
    );
    storage.assertOpen();
    await assert.rejects(
      acquireWorkspaceStorageLock(workspaceRoot, {
        shared: false,
        signal: AbortSignal.timeout(100),
      }),
      { name: "TimeoutError" },
    );
    const competing = await acquireWorkspaceStorageLock(workspaceRoot);
    try {
      const pending = storage.withExclusive(() =>
        assert.fail("exclusive lock must not be acquired"),
      );
      const deadline = AbortSignal.timeout(3000);
      const released = (async () => {
        for (;;) {
          try {
            storage.assertOpen();
          } catch {
            return;
          }
          await delay(10, undefined, { signal: deadline });
        }
      })();
      await Promise.race([released, pending]);
      controller.abort();
      await assert.rejects(pending, { name: "AbortError" });
      assert.throws(() => storage.assertOpen());
    } finally {
      await competing.close();
    }
    const exclusive = await acquireWorkspaceStorageLock(workspaceRoot, {
      shared: false,
      signal: AbortSignal.timeout(1000),
    });
    await exclusive.close();
  } finally {
    await storage.close();
  }
});
