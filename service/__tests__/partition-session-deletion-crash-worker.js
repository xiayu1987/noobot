/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { writeSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { PARTITION_JOURNAL_PUBLICATION_LOCK } from "@noobot/session-protocol/partition-journal";
import { sessionDeletionStagingName } from "@noobot/workspace-protocol/session-tombstone";
import {
  attachmentScopeIndexPath,
  attachSessionRoot,
} from "../../agent/src/artifacts/service/attachment-storage-layout.js";
import { getFsAdapter, setFsAdapter } from "../../agent/src/shared/storage/fs-adapter.js";
import { createPartitionBotRuntime, identity } from "./partition-bot-assembly.test-helpers.js";
import {
  createDeletionHttpFixture,
  runsDirectory,
} from "./partition-session-deletion-crash.test-helpers.js";
import { registerSessionRoutes, withTestServer } from "./routes/session-routes.helpers.js";

test("terminate while processing a session deletion", async (t) => {
  const [workspaceRoot, retainedId, crashStage, window, ancestorId] = process.argv.slice(2);
  const { service, access } = createPartitionBotRuntime(t, { workspaceRoot });
  const { bot } = await service.rebuildRuntimeConfig();
  const { userId, sessionId } = identity;
  const ids = ancestorId ? [ancestorId, sessionId, retainedId] : [sessionId, retainedId];
  for (const id of ids) {
    const session = { ...identity, sessionId: id };
    const parentSessionId = id === sessionId ? (ancestorId ?? "") : "";
    const dialogProcessId = "dialog";
    await bot.session.createSession({ ...session, parentSessionId, caller: SESSION_CALLER.USER });
    await bot.session.appendTurns({
      ...session,
      turns: [
        {
          role: "user",
          messageOrigin: "natural",
          messageUid: "message",
          userMessageId: "um_message",
          content: id,
          dialogProcessId,
          turnScopeId: "turn",
          attachments: [],
          transferEnvelopes: [],
        },
      ],
    });
    const scope = { ...session, dialogProcessId };
    assert.equal(
      await bot.session.withSessionDialogMessageRecords(scope, (messageRecords) =>
        bot.memory.captureDialogToShortMemory({
          ...scope,
          parentSessionId,
          messageRecords,
        }),
      ),
      true,
    );
    const run = join(runsDirectory(bot.getWorkspacePath(userId)), `${id}-run`);
    await mkdir(run, { recursive: true });
    await writeFile(
      join(run, "harness-run.json"),
      JSON.stringify({ sessionId: id, parentSessionId: parentSessionId || null }),
    );
    await writeFile(join(run, "residue"), id);
    const artifacts = [{ name: `${id}.txt`, contentBase64: Buffer.from(id).toString("base64") }];
    assert.equal((await bot.attach.ingestGeneratedArtifacts({ ...session, artifacts })).length, 1);
  }

  const repo = bot.sessionRuntime.repositories.sessionRepository;
  const terminate = () => {
    writeSync(1, `crash:${crashStage}:${window}\n`);
    process.kill(process.pid, "SIGKILL");
  };
  if (window === "recursive-rm" || window === "after-rename") {
    const { sessionDir } = await bot.session.locateSessionScope(identity);
    const staged = join(sessionDir, "..", sessionDeletionStagingName(sessionId));
    const fs = getFsAdapter();
    setFsAdapter({
      ...fs,
      async rename(source, target) {
        await fs.rename(source, target);
        if (window === "after-rename" && source === sessionDir && target === staged) terminate();
      },
      async rm(target, options) {
        if (window === "recursive-rm" && target === staged && options?.recursive) {
          await rm(join(target, PARTITION_JOURNAL_PUBLICATION_LOCK));
          terminate();
        }
        return fs.rm(target, options);
      },
    });
    t.after(() => setFsAdapter(fs));
  } else if (window === "partial-attachment-rm") {
    const basePath = bot.getWorkspacePath(userId);
    const directory = attachSessionRoot(basePath, sessionId);
    const catalog = attachmentScopeIndexPath(basePath, { sessionId, attachmentSource: "model" });
    const fs = getFsAdapter();
    setFsAdapter({
      ...fs,
      async rm(target, options) {
        if (target === directory && options?.recursive) {
          await rm(catalog);
          terminate();
        }
        return fs.rm(target, options);
      },
    });
    t.after(() => setFsAdapter(fs));
  } else if (window === "before-memory-publish") {
    const target = bot.memory.storage.shortPath(bot.getWorkspacePath(userId));
    const fs = getFsAdapter();
    setFsAdapter({
      ...fs,
      async rename(source, destination) {
        if (destination === target) terminate();
        return fs.rename(source, destination);
      },
    });
    t.after(() => setFsAdapter(fs));
  } else {
    const advance = repo.advanceSessionBranchDeletion.bind(repo);
    t.mock.method(repo, "advanceSessionBranchDeletion", async (user, key, completedStage) => {
      if (completedStage === crashStage) terminate();
      return advance(user, key, completedStage);
    });
  }
  const { app, pluginHost } = await createDeletionHttpFixture(t, access);
  registerSessionRoutes(app, { bot: access, runBotOperation: access.runOperation, pluginHost });
  await withTestServer(app, async (url) => {
    const response = await fetch(`${url}/internal/session/${userId}/${sessionId}`, {
      method: "DELETE",
    });
    assert.fail(`Deletion returned before crash: ${response.status} ${await response.text()}`);
  });
});
