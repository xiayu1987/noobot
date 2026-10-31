/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  createTestSessionServices,
  provisionTestSession,
  withTreeContext,
} from "../helpers/session-services.js";
import {
  withTempWorkspace,
  canonicalActivity,
  canonicalMessages,
} from "./session-repository-boundary.summaries.fixtures.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applySessionMessageFacts } from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

test("session save refreshes the display projection with live activity timeline", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "live",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const session = await runtime.repositories.sessionRepository.findById(userId, "live", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "live",
      ),
    });
    session.messages = canonicalMessages(
      [
        {
          attachments: [],
          role: "assistant",
          modelMessageId: "mm_session_repository_bound_1",
          type: "tool_call",
          tool_calls: [{ id: "call-1", name: "read_file", args: {}, type: "tool_call" }],
          content: "",
          chatPresentation: false,
          presentationMessageId: "presentation-live",
          turnScopeId: "turn-live",
          activityTimeline: [
            canonicalActivity({
              eventId: "guidance-analysis:live",
              activityKind: "guidance_analysis",
              purpose: "guidance",
              pluginFlow: "analysis",
              chain: "auxiliary",
              text: "analysis in progress",
              sequenceScopeId: "model-live",
              sessionId: "live",
              turnScopeId: "turn-live",
              presentationMessageId: "presentation-live",
            }),
          ],
        },
      ],
      "live",
      "live",
    );
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(session), {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        session.sessionId,
      ),
    });

    const display = await runtime.repositories.sessionRepository.readSessionDisplaySummary(
      userId,
      "live",
      {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          "live",
        ),
      },
    );
    assert.equal(display.messages.length, 1);
    assert.equal(display.messages[0].presentationMessageId, "presentation-live");
    assert.equal(Object.hasOwn(display.messages[0], "thinkingDetailCount"), false);
    assert.equal(countCanonicalThinkingDetailEvents(display.messages[0]), 1);
    assert.equal(display.messages[0].activityTimeline.length, 1);
    assert.equal(display.messages[0].activityTimeline[0].eventId, "guidance-analysis:live");
  });
});

test("session save leaves the display summary to the revision-checked projection", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "single-summary-write",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const repository = runtime.repositories.sessionRepository;
    const originalWriteJsonAtomic = repository.storageService.writeJsonAtomic.bind(
      repository.storageService,
    );
    let displaySummaryWrites = 0;
    repository.storageService.writeJsonAtomic = async (filePath, payload) => {
      if (String(filePath).endsWith(`${path.sep}session-summary.json`)) displaySummaryWrites += 1;
      return originalWriteJsonAtomic(filePath, payload);
    };
    const session = await repository.findById(userId, "single-summary-write", {
      persistenceContext: repository.treePersistenceContext(userId, "single-summary-write"),
    });
    session.messages = canonicalMessages(
      [{ attachments: [], role: "user", messageOrigin: "natural", content: "one durable update" }],
      "single-summary-write",
      "single_write",
    );

    await repository.save(userId, applySessionMessageFacts(session), {
      persistenceContext: repository.treePersistenceContext(userId, session.sessionId),
    });
    assert.equal(displaySummaryWrites, 0);
    await repository.ensureSessionDisplaySummary(userId, "single-summary-write", {
      persistenceContext: repository.treePersistenceContext(userId, "single-summary-write"),
    });
    assert.equal(displaySummaryWrites, 1);
    await repository.ensureSessionDisplaySummary(userId, "single-summary-write", {
      persistenceContext: repository.treePersistenceContext(userId, "single-summary-write"),
    });
    assert.equal(displaySummaryWrites, 1);
  });
});

test("summary checkpoint receipts survive turn-journal persistence with historical targets", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "checkpoint-receipt";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const repository = runtime.repositories.sessionRepository;
    const session = await repository.findById(userId, sessionId, {
      persistenceContext: repository.treePersistenceContext(userId, sessionId),
    });
    session.messages = [
      {
        attachments: [],
        messageUid: "sm_historical",
        ts: TEST_MESSAGE_TS,
        sessionId,
        role: "assistant",
        modelMessageId: "mm_historical",
        presentationMessageId: "pm_turn-old",
        content: "historical guidance",
        dialogProcessId: "dialog-old",
        turnScopeId: "turn-old",
      },
      {
        attachments: [],
        messageUid: "sm_current",
        ts: TEST_MESSAGE_TS,
        sessionId,
        role: "user",
        messageOrigin: "natural",
        content: "current request",
        dialogProcessId: "dialog-current",
        turnScopeId: "turn-current",
      },
    ];
    session.turnLifecycle = {
      ...createEmptyTurnLifecycle(),
      activeTurnScopeId: "turn-current",
      turns: {
        "turn-current": {
          revision: 1,
          sequence: 1,
          turnScopeId: "turn-current",
          dialogProcessId: "dialog-current",
          presentationMessageId: "presentation-current",
          state: "processing",
        },
      },
    };
    await repository.save(userId, applySessionMessageFacts(session), {
      persistenceContext: repository.treePersistenceContext(userId, session.sessionId),
    });

    const checkpoint = {
      userId,
      sessionId,
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      checkpointId: "checkpoint-with-history",
      expectedCheckpointRevision: 0,
      persistedMessageUids: [],
      summarizedMessageUids: ["sm_historical"],
      retainedMessageUids: [],
    };
    const committed = await runtime.sessionMessageService.commitTurnSummaryCheckpoint(
      withTreeContext(runtime, checkpoint),
    );
    assert.equal(committed.committed, true);

    const sessionFile = path.join(
      workspaceRoot,
      userId,
      "runtime",
      "session",
      sessionId,
      "session.json",
    );
    const manifest = JSON.parse(await readFile(sessionFile, "utf8"));
    assert.equal("messages" in manifest, false);
    assert.deepEqual(
      manifest.turnSummaryCheckpoints["turn-current"].receipts[0].summarizedMessageUids,
      ["sm_historical"],
    );

    const reloaded = await repository.findById(userId, sessionId, {
      persistenceContext: repository.treePersistenceContext(userId, sessionId),
    });
    assert.equal(
      reloaded.messages.find((message) => message.messageUid === "sm_historical").summarized,
      true,
    );
    assert.deepEqual(
      reloaded.turnSummaryCheckpoints["turn-current"].receipts[0].summarizedMessageUids,
      ["sm_historical"],
    );
    const replay = await runtime.sessionMessageService.commitTurnSummaryCheckpoint(
      withTreeContext(runtime, checkpoint),
    );
    assert.equal(replay.deduplicated, true);
  });
});

test("concurrent saves for different sessions preserve every sessions summary entry", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionPathResolver.commitSessionPlacement(userId, {
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "B",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const [sessionA, sessionB] = await Promise.all([
      runtime.repositories.sessionRepository.findById(userId, "A", {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          "A",
        ),
      }),
      runtime.repositories.sessionRepository.findById(userId, "B", {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          "B",
        ),
      }),
    ]);
    sessionA.messages = canonicalMessages(
      [{ attachments: [], role: "user", messageOrigin: "natural", content: "updated A" }],
      "A",
      "concurrent_a",
    );
    sessionB.messages = canonicalMessages(
      [{ attachments: [], role: "user", messageOrigin: "natural", content: "updated B" }],
      "B",
      "concurrent_b",
    );

    await Promise.all([
      runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(sessionA), {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          sessionA.sessionId,
        ),
      }),
      runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(sessionB), {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          sessionB.sessionId,
        ),
      }),
    ]);

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.deepEqual(summary.sessions.map((item) => item.sessionId).sort(), ["A", "B"]);
    assert.equal(summary.sessions.find((item) => item.sessionId === "A").title, "updated A");
    assert.equal(summary.sessions.find((item) => item.sessionId === "B").title, "updated B");
  });
});
