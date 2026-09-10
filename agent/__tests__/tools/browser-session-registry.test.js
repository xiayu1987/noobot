/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_BROWSER_PROFILE_NAME,
  acquireBrowserSession,
  closeAllBrowserSessions,
  closeBrowserSession,
  listBrowserSessions,
  resolveBrowserProfileDirectory,
  resolveBrowserProfileName,
} from "../../src/tools/execution/browser-session-registry.js";

const HEADED_ENV = { DISPLAY: ":0" };

function createPlaywrightStub({ port = 45671 } = {}) {
  const calls = [];
  return {
    calls,
    module: {
      chromium: {
        async launchPersistentContext(profileDirectory, options) {
          calls.push({ profileDirectory, options });
          await fs.writeFile(
            path.join(profileDirectory, "DevToolsActivePort"),
            `${port}\n/devtools/browser/stub`,
            "utf8",
          );
          let closed = false;
          const listeners = [];
          return {
            get closed() {
              return closed;
            },
            on(event, listener) {
              if (event === "close") listeners.push(listener);
            },
            async close() {
              closed = true;
              for (const listener of listeners) listener();
            },
          };
        },
      },
    },
  };
}

async function withProfileRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-browser-profile-"));
  try {
    await run(root);
  } finally {
    await closeAllBrowserSessions();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("browser profile name falls back to the default and rejects traversal", () => {
  assert.equal(resolveBrowserProfileName(""), DEFAULT_BROWSER_PROFILE_NAME);
  assert.equal(resolveBrowserProfileName("  work "), "work");
  for (const candidate of ["../escape", "a/b", "a\\b", ".", "..", "with space", "sep\u0000ate"]) {
    assert.throws(() => resolveBrowserProfileName(candidate), /not allowed/);
  }
});

test("browser profile directory isolates owners and requires an explicit root", () => {
  assert.equal(
    resolveBrowserProfileDirectory({ profileRoot: "/root", userId: "alice", profileName: "work" }),
    path.join("/root", "alice", "work"),
  );
  assert.throws(
    () => resolveBrowserProfileDirectory({ profileRoot: "", userId: "alice" }),
    /root is not configured/,
  );
  assert.throws(
    () => resolveBrowserProfileDirectory({ profileRoot: "/root", userId: "" }),
    /owner is required/,
  );
  assert.throws(
    () => resolveBrowserProfileDirectory({ profileRoot: "/root", userId: "../peer" }),
    /owner is not allowed/,
  );
});

test("acquireBrowserSession requires a configured Chromium executable", async () => {
  await assert.rejects(
    () => acquireBrowserSession({ userId: "alice", executablePath: "  " }),
    /Chromium executable is not configured/,
  );
});

test("acquireBrowserSession rejects a headed request without a display session", async () => {
  await assert.rejects(
    () =>
      acquireBrowserSession({
        userId: "alice",
        executablePath: "/bin/chromium",
        headed: true,
        platform: "linux",
        sourceEnv: {},
      }),
    /active display session/,
  );
});

test("acquireBrowserSession launches a persistent profile under the owner directory", async () => {
  await withProfileRoot(async (root) => {
    const stub = createPlaywrightStub();
    const session = await acquireBrowserSession({
      userId: "alice",
      profileName: "work",
      profileRoot: root,
      headed: true,
      executablePath: "/bin/chromium",
      platform: "linux",
      sourceEnv: HEADED_ENV,
      playwrightModule: stub.module,
    });

    assert.equal(session.profileName, "work");
    assert.equal(session.headed, true);
    assert.match(session.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].profileDirectory, path.join(root, "alice", "work"));
    assert.equal(stub.calls[0].options.headless, false);
    assert.deepEqual(listBrowserSessions(), [{ userId: "alice", profileName: "work" }]);
  });
});

test("acquireBrowserSession never returns the host profile directory", async () => {
  await withProfileRoot(async (root) => {
    const stub = createPlaywrightStub();
    const request = {
      userId: "alice",
      profileName: "work",
      profileRoot: root,
      executablePath: "/bin/chromium",
      playwrightModule: stub.module,
    };
    const created = await acquireBrowserSession(request);
    const reused = await acquireBrowserSession(request);

    for (const session of [created, reused]) {
      assert.deepEqual(Object.keys(session).sort(), ["endpoint", "headed", "profileName"]);
      assert.ok(!JSON.stringify(session).includes(root));
    }
  });
});

test("acquireBrowserSession reuses one browser per owner and profile", async () => {
  await withProfileRoot(async (root) => {
    const stub = createPlaywrightStub();
    const base = {
      profileRoot: root,
      executablePath: "/bin/chromium",
      playwrightModule: stub.module,
    };
    const first = await acquireBrowserSession({ ...base, userId: "alice" });
    const second = await acquireBrowserSession({ ...base, userId: "alice" });
    const other = await acquireBrowserSession({ ...base, userId: "bob" });

    assert.equal(second.endpoint, first.endpoint);
    assert.equal(stub.calls.length, 2);
    assert.equal(other.profileName, DEFAULT_BROWSER_PROFILE_NAME);
    assert.deepEqual(
      listBrowserSessions()
        .map((entry) => entry.userId)
        .sort(),
      ["alice", "bob"],
    );
  });
});

test("acquireBrowserSession refuses to mix headed and headless on one profile", async () => {
  await withProfileRoot(async (root) => {
    const stub = createPlaywrightStub();
    const base = {
      userId: "alice",
      profileName: "work",
      profileRoot: root,
      executablePath: "/bin/chromium",
      platform: "linux",
      playwrightModule: stub.module,
    };
    await acquireBrowserSession({ ...base, headed: false, sourceEnv: {} });
    await assert.rejects(
      () => acquireBrowserSession({ ...base, headed: true, sourceEnv: HEADED_ENV }),
      /already open in headless mode/,
    );
    assert.equal(stub.calls.length, 1);
  });
});

test("acquireBrowserSession drops the session when the launch fails", async () => {
  await withProfileRoot(async (root) => {
    const failing = {
      chromium: {
        async launchPersistentContext() {
          throw new Error("launch refused");
        },
      },
    };
    await assert.rejects(
      () =>
        acquireBrowserSession({
          userId: "alice",
          profileRoot: root,
          executablePath: "/bin/chromium",
          playwrightModule: failing,
        }),
      /launch refused/,
    );
    assert.deepEqual(listBrowserSessions(), []);
  });
});

test("closeBrowserSession closes the browser once and stays idempotent", async () => {
  await withProfileRoot(async (root) => {
    const stub = createPlaywrightStub();
    await acquireBrowserSession({
      userId: "alice",
      profileName: "work",
      profileRoot: root,
      executablePath: "/bin/chromium",
      playwrightModule: stub.module,
    });

    const closed = await closeBrowserSession({ userId: "alice", profileName: "work" });
    assert.deepEqual(closed, { closed: true, profileName: "work" });
    assert.deepEqual(listBrowserSessions(), []);

    const again = await closeBrowserSession({ userId: "alice", profileName: "work" });
    assert.deepEqual(again, { closed: false, profileName: "work" });
  });
});

test("a browser closed outside the registry stops being tracked", async () => {
  await withProfileRoot(async (root) => {
    const stub = createPlaywrightStub();
    let capturedContext = null;
    const observing = {
      chromium: {
        async launchPersistentContext(directory, options) {
          capturedContext = await stub.module.chromium.launchPersistentContext(directory, options);
          return capturedContext;
        },
      },
    };
    await acquireBrowserSession({
      userId: "alice",
      profileRoot: root,
      executablePath: "/bin/chromium",
      playwrightModule: observing,
    });
    assert.equal(listBrowserSessions().length, 1);

    await capturedContext.close();
    assert.deepEqual(listBrowserSessions(), []);
  });
});

test("closeAllBrowserSessions releases every tracked browser", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-browser-profile-all-"));
  try {
    const stub = createPlaywrightStub();
    const base = {
      profileRoot: root,
      executablePath: "/bin/chromium",
      playwrightModule: stub.module,
    };
    await acquireBrowserSession({ ...base, userId: "alice", profileName: "work" });
    await acquireBrowserSession({ ...base, userId: "bob", profileName: "home" });

    assert.deepEqual(await closeAllBrowserSessions(), { closed: 2 });
    assert.deepEqual(listBrowserSessions(), []);
    assert.deepEqual(await closeAllBrowserSessions(), { closed: 0 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
