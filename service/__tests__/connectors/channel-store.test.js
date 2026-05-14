import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getConnectorChannelStore,
  initConnectorChannelStore,
} from "../../system-core/connectors/channel-store.js";

const sessionIdsToCleanup = new Set();

function createSessionId(prefix = "test") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function trackSession(sessionId = "") {
  const normalized = String(sessionId || "").trim();
  if (normalized) sessionIdsToCleanup.add(normalized);
  return normalized;
}

afterEach(() => {
  const store = getConnectorChannelStore();
  for (const sessionId of sessionIdsToCleanup) {
    store.releaseSessionConnectors(sessionId);
  }
  sessionIdsToCleanup.clear();
});

test("connector channel store is singleton", () => {
  const storeA = initConnectorChannelStore();
  const storeB = getConnectorChannelStore();
  assert.equal(storeA, storeB);
});

test("connect/disconnect connectors should update per-session buckets", () => {
  const store = getConnectorChannelStore();
  const sessionId = trackSession(createSessionId("bucket"));

  const db = store.connectConnector({
    sessionId,
    connectorName: "db-main",
    connectorType: "database",
    connectionInfo: { database_type: "postgres" },
  });
  const terminal = store.connectConnector({
    sessionId,
    connectorName: "ssh-main",
    connectorType: "terminal",
    connectionInfo: { host: "127.0.0.1", port: 22, username: "root" },
  });
  const email = store.connectConnector({
    sessionId,
    connectorName: "mail-main",
    connectorType: "email",
    connectionInfo: { smtp_host: "smtp.example.com", imap_host: "imap.example.com" },
  });

  assert.equal(db.connectorType, "database");
  assert.equal(terminal.connectorType, "terminal");
  assert.equal(email.connectorType, "email");

  const snapshot = store.getSessionConnectors(sessionId);
  assert.equal(snapshot.databases.length, 1);
  assert.equal(snapshot.terminals.length, 1);
  assert.equal(snapshot.emails.length, 1);

  const deleted = store.disconnectConnector({
    sessionId,
    connectorName: "ssh-main",
    connectorType: "terminal",
  });
  assert.equal(deleted, true);

  const afterDeleteSnapshot = store.getSessionConnectors(sessionId);
  assert.equal(afterDeleteSnapshot.databases.length, 1);
  assert.equal(afterDeleteSnapshot.terminals.length, 0);
  assert.equal(afterDeleteSnapshot.emails.length, 1);

  const deletedAgain = store.disconnectConnector({
    sessionId,
    connectorName: "ssh-main",
    connectorType: "terminal",
  });
  assert.equal(deletedAgain, false);
});

test("inspectConnectorRuntimeStatus validates identity and session", async () => {
  const store = getConnectorChannelStore();

  const noSession = await store.inspectConnectorRuntimeStatus({
    sessionId: "",
    connectorName: "db-main",
    connectorType: "database",
  });
  assert.equal(noSession.status, "unknown");
  assert.equal(noSession.status_code, 400);

  const invalidIdentity = await store.inspectConnectorRuntimeStatus({
    sessionId: createSessionId("invalid"),
    connectorName: "",
    connectorType: "",
  });
  assert.equal(invalidIdentity.status, "invalid");
  assert.equal(invalidIdentity.status_code, 400);
});

test("executeConnectorCommand should reject when command is empty", async () => {
  const store = getConnectorChannelStore();
  const sessionId = trackSession(createSessionId("cmd"));
  store.connectConnector({
    sessionId,
    connectorName: "db-cmd",
    connectorType: "database",
    connectionInfo: { database_type: "sqlite" },
  });

  await assert.rejects(
    store.executeConnectorCommand({
      sessionId,
      connectorName: "db-cmd",
      connectorType: "database",
      command: "",
    }),
    (error) => error instanceof Error && String(error.message || "").trim().length > 0,
  );
});

