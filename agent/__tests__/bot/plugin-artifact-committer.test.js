/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { commitPluginArtifact } from "../../src/bot/session/plugin-artifact-committer.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

test("plugin artifact port owns persistence and publication behind one generic contract", async () => {
  const commits = [];
  const publications = [];
  const envelope = createPluginArtifactEnvelope({
    pluginId: "example",
    artifactType: "example.document",
    artifactId: "document-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    data: { title: "document" },
  });
  const agentContext = createTestAgentExecutionScope({
    userId: "user-1",
    systemRuntime: {
      sessionId: "session-1",
      parentSessionId: "",
      turnScopeId: "turn-1",
    },
    sessionManager: {
      async commitAuthorityEvent(input) {
        commits.push(input);
        return { committed: true, envelope };
      },
    },
    eventListener: { onEvent: async (event) => publications.push(event) },
  });

  const result = await commitPluginArtifact({
    pluginId: "example",
    artifact: {
      artifactType: "example.document",
      artifactId: "document-1",
      operation: "created",
      data: { title: "document" },
    },
    toolContext: { agentContext },
  });

  assert.equal(result.committed, true);
  assert.equal(result.eventId, envelope.identity.eventId);
  assert.deepEqual(
    {
      family: commits[0].family,
      scopeId: commits[0].ordering.scopeId,
      pluginId: commits[0].payload.pluginId,
      artifactType: commits[0].payload.artifactType,
      artifactId: commits[0].payload.artifactId,
    },
    {
      family: "plugin.artifact",
      scopeId: "session-1:example:example.document:document-1",
      pluginId: "example",
      artifactType: "example.document",
      artifactId: "document-1",
    },
  );
  assert.equal(publications[0].event, "authority_event_committed");
  assert.equal(publications[0].data.envelope, envelope);
});
