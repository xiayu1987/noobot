/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendIndexPath = resolve(__dirname, "../frontend/index.js");

function loadFrontendRegistration() {
  const source = readFileSync(frontendIndexPath, "utf8")
    .replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["'];/g, "const $1 = {};")
    .replace("export const FRONTEND_PLUGIN_API_VERSION", "const FRONTEND_PLUGIN_API_VERSION")
    .replace("export function registerFrontendPlugin", "function registerFrontendPlugin");
  const sandbox = {};
  vm.runInNewContext(`${source}\n;globalThis.__frontend = { registerFrontendPlugin };`, sandbox, {
    filename: frontendIndexPath,
  });
  return sandbox.__frontend.registerFrontendPlugin;
}

function resolveMonotonicProps(context) {
  const registeredPlugins = [];
  const registerFrontendPlugin = loadFrontendRegistration();
  registerFrontendPlugin({
    registerFrontendPlugin(plugin) {
      registeredPlugins.push(plugin);
    },
  });
  const messageActionsPlugin = registeredPlugins.find((plugin) => plugin.id === "message-actions");
  const monotonicAction = messageActionsPlugin.messageActions.find(
    (action) => action.id === "monotonic-message-actions",
  );
  return monotonicAction.resolveProps({
    deleteMonotonicMessage() {},
    resendMonotonicMessage() {},
    ...context,
  });
}

test("monotonic actions are visible for the last plain user orphan message", () => {
  const orphan = {
    id: "tail-user",
    role: "user",
    type: "message",
    content: "全仓回归测试",
    dialogProcessId: "round-1",
  };

  const props = resolveMonotonicProps({
    messageItem: orphan,
    allMessages: [
      { id: "previous-user", role: "user", type: "message", content: "old", dialogProcessId: "round-0" },
      { id: "previous-assistant", role: "assistant", content: "done", dialogProcessId: "round-0", status: "completed" },
      orphan,
    ],
  });

  assert.equal(props.visible, true);
  assert.equal(props.messageItem, orphan);
});

test("monotonic actions stay hidden for non-tail orphan user messages", () => {
  const orphan = {
    id: "middle-user",
    role: "user",
    type: "message",
    content: "not tail",
    dialogProcessId: "round-1",
  };

  const props = resolveMonotonicProps({
    messageItem: orphan,
    allMessages: [
      orphan,
      { id: "assistant-result", role: "assistant", content: "result", dialogProcessId: "round-1" },
    ],
  });

  assert.equal(props.visible, false);
});

test("monotonic actions stay hidden for non-user tail messages", () => {
  const assistant = {
    id: "tail-assistant",
    role: "assistant",
    content: "done",
    dialogProcessId: "round-1",
  };

  const props = resolveMonotonicProps({
    messageItem: assistant,
    allMessages: [assistant],
  });

  assert.equal(props.visible, false);
});

test("different dialogProcessId messages after a user orphan do not block its actions", () => {
  const orphan = {
    id: "tail-for-round-1",
    role: "user",
    type: "message",
    content: "全仓回归测试",
    dialogProcessId: "round-1",
  };

  const props = resolveMonotonicProps({
    messageItem: orphan,
    allMessages: [
      orphan,
      { id: "other-round-user", role: "user", type: "message", content: "new branch", dialogProcessId: "round-2" },
      { id: "other-round-assistant", role: "assistant", content: "done", dialogProcessId: "round-2" },
    ],
  });

  assert.equal(props.visible, true);
});
