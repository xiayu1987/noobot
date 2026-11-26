/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { json } from "node:stream/consumers";
import { createRuntimeConfigService } from "../services/runtime-config-service.js";
import { createServiceBotAccess } from "../services/service-bot-access.js";
import { express, registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";
import { createPartitionSessionServices, createSessionFacade } from "noobot-agent/session";
import { AttachmentService } from "noobot-agent/attach";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { initializeUserWorkspace } from "../../agent/__tests__/helpers/user-workspace.js";
import { journalTestLimits } from "../../agent/__tests__/helpers/partition-journal-cases.js";
import { TEST_SCOPED_SESSION_ROOTS } from "../../agent/__tests__/helpers/scoped-session-roots.js";

async function fixture(t, previous = null) {
  const pluginRootDir = await mkdtemp(join(tmpdir(), "runtime-rebuild-"));
  t.after(() => rm(pluginRootDir, { recursive: true, force: true }));
  const state = { bot: previous, raw: null, resolved: null };
  const access = createServiceBotAccess({ getBot: () => state.bot });
  const candidates = [];
  let builds = 0;
  let failBuild = null;
  const createSessionRuntime = () => assert.fail("Candidate must not assemble storage");
  class Candidate {
    constructor(config, options) {
      assert.equal(options.createSessionRuntime, createSessionRuntime);
      this.config = config;
      this.closes = 0;
      this.failure = null;
      this.session = {
        getAllSessionSummaries: async () => {
          assert.equal(this.closes, 0, "closed runtime was reused by HTTP");
          return { sessions: [], revision: config.revision };
        },
        readServerNow: () => "2026-11-20T00:00:00.000Z",
      };
      candidates.push(this);
    }
    async close() {
      this.closes += 1;
      if (this.failure) throw this.failure;
    }
  }
  const service = createRuntimeConfigService({
    startupContext: { paths: { pluginRootDir } },
    now: () => "2026-11-20T00:00:00.000Z",
    readWorkspaceConfigParams: async () => ({ values: {} }),
    globalConfigBuilder: {
      async build() {
        builds += 1;
        if (failBuild) throw failBuild;
        return { persistedConfig: { revision: builds }, resolvedConfig: { revision: builds } };
      },
    },
    BotManager: Candidate,
    createSessionRuntime,
    connectorAccessPort: { access() {}, listUserConnectors() {} },
    getBot: () => state.bot,
    withBotRetirement: access.withRetirement,
    setBot: (bot) => {
      state.bot = bot;
    },
    setGlobalConfigRaw: (raw) => {
      state.raw = raw;
    },
    setGlobalConfig: (resolved) => {
      state.resolved = resolved;
    },
  });
  return {
    service,
    state,
    candidates,
    access,
    get builds() {
      return builds;
    },
    failBuild(cause) {
      failBuild = cause;
    },
  };
}

test("initial config publishes without retiring a nonexistent runtime", async (t) => {
  const { service, state, candidates } = await fixture(t);
  const result = await service.rebuildRuntimeConfig();
  assert.equal(state.bot, result.bot);
  assert.equal(state.raw, result.globalConfigRaw);
  assert.equal(state.resolved, result.globalConfig);
  assert.equal(candidates[0].closes, 0);
});

test("replacement waits for old runtime release and serializes concurrent rebuilds", async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const old = {
    async close() {
      entered.resolve();
      await release.promise;
    },
  };
  const f = await fixture(t, old);
  const first = f.service.rebuildRuntimeConfig();
  const second = f.service.rebuildRuntimeConfig();
  await entered.promise;
  assert.equal(f.state.bot, old);
  assert.equal(f.state.raw, null);
  assert.equal(f.builds, 1);
  release.resolve();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.bot, f.candidates[0]);
  assert.equal(two.bot, f.candidates[1]);
  assert.equal(f.candidates[0].closes, 1);
  assert.equal(f.state.bot, two.bot);
  assert.equal(f.state.raw.revision, 2);
});

test("failed retirement keeps configuration unpublished, cleans the candidate and allows retry", async (t) => {
  const failure = new Error("old snapshot release failed");
  let attempts = 0;
  const old = {
    async close() {
      if (++attempts === 1) throw failure;
    },
  };
  const f = await fixture(t, old);
  await assert.rejects(f.service.rebuildRuntimeConfig(), (cause) => cause === failure);
  assert.equal(f.state.bot, old);
  assert.equal(f.state.raw, null);
  assert.equal(f.state.resolved, null);
  assert.equal(f.candidates[0].closes, 1);
  await assert.rejects(
    f.access.runOperation(() => f.access.session),
    { code: "RUNTIME_CLOSED" },
  );
  assert.throws(() => f.access.getWorkspacePath("user"), { code: "RUNTIME_CLOSED" });
  const result = await f.service.rebuildRuntimeConfig();
  assert.equal(attempts, 2);
  assert.equal(f.state.bot, result.bot);
  assert.equal(f.candidates[1].closes, 0);
  assert.equal(await f.access.runOperation(() => f.access.session), result.bot.session);
});

test("a build failure does not close the current runtime or poison queued rebuilds", async (t) => {
  let closes = 0;
  const old = {
    async close() {
      closes += 1;
    },
  };
  const f = await fixture(t, old);
  const failure = new Error("invalid config");
  f.failBuild(failure);
  await assert.rejects(f.service.rebuildRuntimeConfig(), (cause) => cause === failure);
  assert.equal(closes, 0);
  assert.equal(f.state.bot, old);
  f.failBuild(null);
  await f.service.rebuildRuntimeConfig();
  assert.equal(closes, 1);
});

test("registered HTTP routes use the current runtime after each rebuild", async (t) => {
  const f = await fixture(t);
  await f.service.rebuildRuntimeConfig();
  const app = express();
  registerSessionRoutes(app, {
    bot: f.access,
    runBotOperation: f.access.runOperation,
    translateText: (key) => key,
  });
  await withTestServer(app, async (baseUrl) => {
    for (const revision of [1, 2, 3]) {
      const response = await new Promise((resolve, reject) => {
        get(`${baseUrl}/internal/sessions/user`, resolve).once("error", reject);
      });
      assert.equal(response.statusCode, 200);
      assert.equal((await json(response)).revision, revision);
      if (revision < 3) await f.service.rebuildRuntimeConfig();
    }
  });
  assert.deepEqual(
    f.candidates.map((candidate) => candidate.closes),
    [1, 1, 0],
  );
});

test("runtime replacement waits for a real partition reader before publishing", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "runtime-partition-handoff-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, "user");
  const runtime = createPartitionSessionServices(
    { workspaceRoot },
    {
      now: () => "2026-11-20T00:00:00.000Z",
      attachmentService: new AttachmentService({ workspaceRoot }),
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
      journalLimits: journalTestLimits({ transactionBytes: 16 * 1024 }),
      maxJournals: 1,
    },
  );
  t.after(() => runtime.close());
  const facade = createSessionFacade(runtime);
  const identity = { userId: "user", sessionId: "session", persistenceScope: null };
  await facade.createSession({ ...identity, parentSessionId: "", caller: SESSION_CALLER.USER });
  await using reader = await runtime.repositories.sessionRepository.requireSessionReader(
    identity.userId,
    identity.sessionId,
    { persistenceContext: runtime.createSessionPersistenceContext(identity) },
  );
  const entered = Promise.withResolvers();
  const old = {
    session: facade,
    close() {
      entered.resolve();
      return runtime.close();
    },
  };
  const f = await fixture(t, old);
  const replacement = f.service.rebuildRuntimeConfig();
  await entered.promise;
  try {
    assert.equal(f.state.bot, old);
    assert.equal((await reader.readMetadata()).sessionId, "session");
    await assert.rejects(facade.getSessionBundle(identity), { code: "SESSION_STORAGE_CLOSED" });
  } finally {
    await reader.close();
  }
  const result = await replacement;
  assert.equal(f.state.bot, result.bot);
  assert.notEqual(f.state.bot, old);
});
