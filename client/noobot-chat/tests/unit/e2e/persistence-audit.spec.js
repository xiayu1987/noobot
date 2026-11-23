/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "@noobot/path-resolver";
import {
  auditSessionSummaryArtifacts,
  readSessionFact,
  parseJsonLines,
  iterateCommittedJsonLines,
  readPluginLogArtifacts,
  readHarnessRun,
  readHarnessContext,
  waitForHarnessRun,
} from "../../e2e/protocol/helpers/persistence-audit.js";
import { rotatedPluginLogName } from "@noobot/plugin-protocol/log-artifact";
import {
  createTestPartitionSessionServices,
  provisionTestSession,
  submitTestSessionRequest,
} from "../../../../../agent/__tests__/helpers/session-services.js";
import { initializeUserWorkspace } from "../../../../../agent/__tests__/helpers/user-workspace.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { FileSystemSessionRepository } from "noobot-agent/session";
import { createSessionPersistenceScope } from "@noobot/session-protocol";
import { canonicalActivity } from "../../../../../agent/__tests__/session/session-repository-boundary.summaries.fixtures.js";
import { journalTestLimits } from "../../../../../agent/__tests__/helpers/partition-journal-cases.js";

async function configureAuditWorkspace(directory) {
  const configPath = path.join(directory, "global.config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      workspace_root: directory,
      partitionSessionStorage: {
        journalLimits: journalTestLimits({ transactionBytes: 16 * 1024 }),
        maxJournals: 4,
      },
    }),
  );
  vi.stubEnv("NOOBOT_WORKSPACE_ROOT", directory);
  vi.stubEnv("NOOBOT_GLOBAL_CONFIG_PATH", configPath);
  await initializeUserWorkspace(directory, "u1");
}

describe("partition session persistence audit", () => {
  it("reads a publication committed before the list through the same partition authority", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "immutable-audit-publisher-"));
    let publishDuringList;
    try {
      await configureAuditWorkspace(directory);
      await using runtime = createTestPartitionSessionServices({ workspaceRoot: directory });
      await provisionTestSession(runtime, {
        userId: "u1",
        sessionId: "s1",
        caller: SESSION_CALLER.USER,
      });
      const repo = runtime.repositories.sessionRepository;
      const reader = await repo.requireSessionReader("u1", "s1", {
        persistenceContext: repo.treePersistenceContext("u1", "s1"),
      });
      const before = reader.generation;
      await reader.close();
      await runtime.close();
      const readList = FileSystemSessionRepository.prototype.readSessionsSummary;
      publishDuringList = vi
        .spyOn(FileSystemSessionRepository.prototype, "readSessionsSummary")
        .mockImplementationOnce(async function (...args) {
          await this.withSessionCommit(
            "u1",
            "s1",
            async ({ prepareRequest, commitChanges }) =>
              commitChanges(
                await prepareRequest({
                  operationId: "background-maintenance",
                  committedAt: "2026-01-01T00:00:00.000Z",
                  changes: { sessionMetadata: { customTitle: "published title" } },
                }),
              ),
            { persistenceContext: this.treePersistenceContext("u1", "s1") },
          );
          return readList.apply(this, args);
        });
      const audit = await auditSessionSummaryArtifacts("u1", "s1");
      expect(audit.status).toBe("passed");
      expect(audit.sessions[0].generation).toBe(before + 1);
      expect(audit.listTitle).toBe("published title");
    } finally {
      publishDuringList?.mockRestore();
      vi.unstubAllEnvs();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("audits assistant details in tree and detached descendants and rejects damaged descendant objects", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "immutable-descendant-audit-"));
    try {
      await configureAuditWorkspace(directory);
      await using runtime = createTestPartitionSessionServices({ workspaceRoot: directory });
      const repo = runtime.repositories.sessionRepository;
      await provisionTestSession(runtime, {
        userId: "u1",
        sessionId: "root",
        caller: SESSION_CALLER.USER,
      });
      await provisionTestSession(runtime, {
        userId: "u1",
        sessionId: "child",
        parentSessionId: "root",
        caller: SESSION_CALLER.BOT,
      });
      const detachedContext = runtime.createSessionPersistenceContext({
        userId: "u1",
        sessionId: "detached",
        persistenceScope: createSessionPersistenceScope({
          scopeId: "agent:detached",
          parentSessionId: "child",
          allowedRoot: "runtime/agent/session",
          relativeDir: "runtime/agent/session/detached",
        }),
      });
      await repo.ensureSession({
        userId: "u1",
        sessionId: "detached",
        parentSessionId: "child",
        caller: SESSION_CALLER.BOT,
        persistenceContext: detachedContext,
      });
      for (const sessionId of ["child", "detached"]) {
        const persistenceContext =
          sessionId === "detached" ? detachedContext : repo.treePersistenceContext("u1", sessionId);
        await using reader = await repo.requireSessionReader("u1", sessionId, {
          persistenceContext,
        });
        await submitTestSessionRequest(
          repo,
          "u1",
          sessionId,
          await reader.prepareRequest({
            operationId: `seed-${sessionId}`,
            committedAt: "2026-01-01T00:00:00.000Z",
            changes: {
              messages: [
                {
                  sessionId,
                  parentSessionId: sessionId === "child" ? "root" : "child",
                  messageUid: `assistant-${sessionId}`,
                  modelMessageId: `model-${sessionId}`,
                  presentationMessageId: `presentation-${sessionId}`,
                  dialogProcessId: `dialog-${sessionId}`,
                  parentDialogProcessId: "",
                  turnScopeId: `turn-${sessionId}`,
                  role: "assistant",
                  type: "message",
                  content: "done",
                  attachments: [],
                  ts: "2026-01-01T00:00:00.000Z",
                  activityTimeline: [
                    canonicalActivity({
                      sessionId,
                      dialogProcessId: `dialog-${sessionId}`,
                      turnScopeId: `turn-${sessionId}`,
                      presentationMessageId: `presentation-${sessionId}`,
                    }),
                  ],
                },
              ],
            },
          }),
          persistenceContext,
        );
      }
      const detachedScope = await repo.requireSessionScope("u1", "detached", detachedContext);
      await runtime.close();
      const audit = await auditSessionSummaryArtifacts("u1", "root");
      expect(audit.projectionCount).toBe(3);
      expect(audit.thinkingDetailCount).toBe(2);
      expect(audit.sessions.map((item) => item.sessionId).sort()).toEqual([
        "child",
        "detached",
        "root",
      ]);
      await fs.writeFile(path.join(detachedScope.sessionDir, "CURRENT"), "corrupt");
      await expect(auditSessionSummaryArtifacts("u1", "root")).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("audits canonical list and display facts without legacy files, pins reads and detects damage", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "immutable-audit-"));
    try {
      await configureAuditWorkspace(directory);
      await using runtime = createTestPartitionSessionServices({ workspaceRoot: directory });
      const repo = runtime.repositories.sessionRepository;
      await provisionTestSession(runtime, {
        userId: "u1",
        sessionId: "s1",
        caller: SESSION_CALLER.USER,
      });
      const persistenceContext = repo.treePersistenceContext("u1", "s1");
      const scope = await repo.requireSessionScope("u1", "s1", persistenceContext);
      await using pinned = await repo.requireSessionReader("u1", "s1", { persistenceContext });
      await submitTestSessionRequest(
        repo,
        "u1",
        "s1",
        await pinned.prepareRequest({
          operationId: "seed-audit",
          committedAt: "2026-01-01T00:00:00.000Z",
          changes: {
            messages: [
              {
                messageUid: "m1",
                userMessageId: "m1",
                sessionId: "s1",
                parentSessionId: "",
                dialogProcessId: "d1",
                parentDialogProcessId: "",
                turnScopeId: "t1",
                role: "user",
                type: "message",
                messageOrigin: "natural",
                content: "[PBE:test] task",
                attachments: [],
                transferEnvelopes: [],
                ts: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        }),
        persistenceContext,
      );
      await fs.writeFile(
        path.join(scope.sessionDir, "session-summary.json"),
        "unreadable obsolete cache",
      );
      expect((await pinned.readDisplayProjection()).messages).toEqual([]);
      await pinned.close();
      await runtime.close();
      await fs.writeFile(scope.sessionFile, "unreadable obsolete manifest");
      await expect(readSessionFact("u1", "s1")).rejects.toMatchObject({
        code: "SESSION_STORAGE_CORRUPT",
        message: "Session has multiple storage authorities",
      });
      await expect(auditSessionSummaryArtifacts("u1", "s1")).rejects.toMatchObject({
        code: "E2E_SESSION_SUMMARY_ARTIFACT_INVALID",
        audit: { status: "failed", listAvailability: "unavailable" },
      });
      await fs.rm(scope.sessionFile);
      const audit = await auditSessionSummaryArtifacts("u1", "s1", {
        requiredTitlePrefix: "[PBE:",
      });
      expect(audit).toMatchObject({
        protocolVersion: 3,
        authority: "partition_session_projection",
        status: "passed",
        projectionCount: 1,
        listAvailability: "available",
      });
      expect(audit.sessions[0].generation).toBe(pinned.generation + 1);
      expect(
        (await readSessionFact("u1", "s1")).messages.map((message) => message.messageUid),
      ).toEqual(["m1"]);
      const readList = FileSystemSessionRepository.prototype.readSessionsSummary;
      const publishDuringList = vi
        .spyOn(FileSystemSessionRepository.prototype, "readSessionsSummary")
        .mockImplementationOnce(async function (...args) {
          const list = await readList.apply(this, args);
          await this.withSessionCommit(
            "u1",
            "s1",
            async ({ prepareRequest, commitChanges }) =>
              commitChanges(
                await prepareRequest({
                  operationId: "concurrent-audit",
                  committedAt: "2026-01-01T00:00:01.000Z",
                  changes: {
                    messages: [
                      {
                        messageUid: "m2",
                        userMessageId: "m2",
                        sessionId: "s1",
                        parentSessionId: "",
                        dialogProcessId: "d2",
                        parentDialogProcessId: "",
                        turnScopeId: "t2",
                        role: "user",
                        type: "message",
                        messageOrigin: "natural",
                        content: "second task",
                        attachments: [],
                        transferEnvelopes: [],
                        ts: "2026-01-01T00:00:01.000Z",
                      },
                    ],
                  },
                }),
              ),
            { persistenceContext: this.treePersistenceContext("u1", "s1") },
          );
          return list;
        });
      try {
        await expect(auditSessionSummaryArtifacts("u1", "s1")).rejects.toMatchObject({
          message: expect.stringContaining("session list and detail projections disagree"),
          audit: { status: "failed" },
        });
      } finally {
        publishDuringList.mockRestore();
      }
      await expect(
        auditSessionSummaryArtifacts("u1", "s1", { requiredTitlePrefix: "wrong" }),
      ).rejects.toThrow("required identity prefix");
      await expect(
        auditSessionSummaryArtifacts("u1", "s1", { expectation: "forbidden" }),
      ).rejects.toThrow("registered a persistence scope");
      await expect(
        auditSessionSummaryArtifacts("u1", "missing", { expectation: "forbidden" }),
      ).resolves.toMatchObject({ status: "passed", projectionCount: 0 });
      await fs.writeFile(path.join(scope.sessionDir, "CURRENT"), "corrupt");
      await expect(auditSessionSummaryArtifacts("u1", "s1")).rejects.toThrow(
        "canonical list projection",
      );
      await expect(
        auditSessionSummaryArtifacts("u1", "s1", { expectation: "unavailable" }),
      ).resolves.toMatchObject({ listAvailability: "unavailable" });
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("parseJsonLines", () => {
  it("audits resumed runs without requiring a context-build artifact and keeps snapshot reads strict", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "harness-resume-audit-"));
    vi.stubEnv("NOOBOT_WORKSPACE_ROOT", directory);
    const root = path.join(directory, "admin/runtime/plugin-data/harness/runs/resumed");
    try {
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, "harness-run.json"),
        JSON.stringify({ status: "success" }),
      );
      await fs.writeFile(path.join(root, "events.jsonl"), '{"point":"agent.after_turn"}\n');
      const result = await waitForHarnessRun(
        "admin",
        "resumed",
        (value) => value.run.status === "success",
        { timeoutMs: 1000 },
      );
      expect(result.events).toEqual([{ point: "agent.after_turn" }]);
      await expect(readHarnessContext("admin", "resumed")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await fs.writeFile(path.join(root, "context-snapshot.json"), '{"messages":[]}');
      expect(await readHarnessContext("admin", "resumed")).toEqual({ messages: [] });
      await fs.writeFile(path.join(root, "events.jsonl"), "corrupt\n");
      await expect(readHarnessRun("admin", "resumed")).rejects.toThrow(SyntaxError);
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("audits rotated plugin evidence as well as the active log and rejects corruption", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-log-audit-"));
    const archive = rotatedPluginLogName({
      name: "events",
      extension: ".jsonl",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      suffix: "first",
    });
    try {
      await fs.writeFile(path.join(directory, archive), '{"event":"planning"}\n');
      await fs.writeFile(path.join(directory, "events.jsonl"), '{"event":"completed"}\n');
      await fs.writeFile(path.join(directory, "prompts.other.jsonl"), "not-json\n");
      await fs.mkdir(path.join(directory, "events.directory.jsonl"));
      expect(await readPluginLogArtifacts(directory, "events.jsonl")).toEqual([
        { event: "planning" },
        { event: "completed" },
      ]);
      await fs.appendFile(path.join(directory, archive), "not-json\n");
      await expect(readPluginLogArtifacts(directory, "events.jsonl")).rejects.toThrow(SyntaxError);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("reads only newline-committed frames from an active JSONL segment", () => {
    expect(parseJsonLines('{"seq":1}\n{"seq":', { committedFramesOnly: true })).toEqual([
      { seq: 1 },
    ]);
  });

  it("keeps strict validation for malformed committed frames", () => {
    expect(() =>
      parseJsonLines('{"seq":1}\nnot-json\n{"seq":2}\n', { committedFramesOnly: true }),
    ).toThrow(SyntaxError);
  });

  it("parses a complete final frame when reading a closed JSONL artifact", () => {
    expect(parseJsonLines('{"seq":1}', { committedFramesOnly: false })).toEqual([{ seq: 1 }]);
  });

  it("streams chunk-spanning Unicode frames, ignores uncommitted tails and rejects corrupt evidence", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "audit-stream-"));
    const file = path.join(directory, "events.jsonl");
    const records = [{ body: "汉字🙂".repeat(20000) }, { seq: 2 }];
    const collect = async () => {
      const result = [];
      for await (const record of iterateCommittedJsonLines(file)) result.push(record);
      return result;
    };
    try {
      await fs.writeFile(
        file,
        records.map((record) => JSON.stringify(record)).join("\r\n") + '\n{"seq":',
      );
      expect(await collect()).toEqual(records);
      await fs.appendFile(file, "broken\n");
      await expect(collect()).rejects.toThrow(SyntaxError);
      await fs.unlink(file);
      await expect(collect()).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
