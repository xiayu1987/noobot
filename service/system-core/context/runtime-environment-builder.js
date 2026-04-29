/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { initRuntimeSharedBrowser } from "../utils/web-browser-simulate.js";
import {
  cleanAndDedupTextLines,
  extractReadableTextFromHtml,
  extractVisibleTextFromHtml,
} from "../utils/web-text-cleaner.js";
import { cleanTextUniversal } from "../utils/text-cleaner.js";
import {
  decryptPayloadBySessionId,
  encryptPayloadBySessionId,
} from "../utils/session-crypto.js";
import { getConnectorChannelStore } from "../connectors/channel-store.js";
import { getConnectorHistoryStore } from "../connectors/history-store.js";
import { createConnectorEventListener } from "../connectors/connector-event-listener.js";
import {
  createCurrentTurnMessagesStore,
  createCurrentTurnTasksStore,
} from "./current-turn-store.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function defaultSharedFetch(url, init = {}) {
  return await globalThis.fetch(url, init);
}

function createDefaultTextCleaner() {
  return {
    cleanUniversal(input = "", options = {}) {
      return cleanTextUniversal(input, options || {});
    },
    cleanText(input = "", maxLines = 4000) {
      return cleanAndDedupTextLines(String(input || ""), maxLines);
    },
    cleanHtml(input = "", { url = "", readable = false } = {}) {
      const html = String(input || "");
      if (!html) return "";
      if (readable) {
        return (
          extractReadableTextFromHtml(html, String(url || "")) ||
          extractVisibleTextFromHtml(html)
        );
      }
      return extractVisibleTextFromHtml(html);
    },
    cleanAny(input = "", { contentType = "", url = "" } = {}) {
      return cleanTextUniversal(String(input || ""), {
        format: "auto",
        contentType: String(contentType || ""),
        url: String(url || ""),
        maxChars: 200000,
      });
    },
  };
}

export function buildRuntimeContext({
  userId = "",
  basePath = "",
  globalConfig = {},
  userConfig = {},
  eventListener = null,
  sessionManager = null,
  attachmentService = null,
  botManager = null,
  userInteractionBridge = null,
  abortSignal = null,
  runtimeModel = "",
  allEnabledProviders = {},
  parentAsyncResultContainer = null,
  runConfig = {},
  systemRuntime = {},
  attachmentMetas = [],
} = {}) {
  const passthroughSharedTools =
    runConfig?.sharedTools && typeof runConfig.sharedTools === "object"
      ? runConfig.sharedTools
      : {};
  return {
    userId: String(userId || "").trim(),
    basePath: String(basePath || "").trim(),
    globalConfig,
    userConfig,
    eventListener,
    sessionManager,
    attachmentService,
    botManager,
    userInteractionBridge,
    abortSignal: abortSignal || null,
    runtimeModel: String(runtimeModel || "").trim(),
    allEnabledProviders:
      allEnabledProviders && typeof allEnabledProviders === "object"
        ? allEnabledProviders
        : {},
    sharedTools: passthroughSharedTools,
    childAsyncResultContainers: [],
    parentAsyncResultContainer:
      parentAsyncResultContainer && typeof parentAsyncResultContainer === "object"
        ? parentAsyncResultContainer
        : null,
    systemRuntime: systemRuntime && typeof systemRuntime === "object" ? systemRuntime : {},
    currentTurnMessages: createCurrentTurnMessagesStore(),
    currentTurnTasks: createCurrentTurnTasksStore(),
    attachmentMetas: Array.isArray(attachmentMetas) ? attachmentMetas : [],
  };
}

export async function initializeRuntimeEnvironment(runtimeContext = {}) {
  if (!isPlainObject(runtimeContext)) return;
  const sharedTools = isPlainObject(runtimeContext.sharedTools)
    ? runtimeContext.sharedTools
    : {};
  runtimeContext.sharedTools = sharedTools;
  const sessionId = String(runtimeContext?.systemRuntime?.sessionId || "").trim();
  const rootSessionId = String(
    runtimeContext?.systemRuntime?.rootSessionId || sessionId || "",
  ).trim();

  if (typeof sharedTools.fetch !== "function") {
    sharedTools.fetch =
      typeof globalThis.fetch === "function" ? defaultSharedFetch : null;
  }

  const defaultTextCleaner = createDefaultTextCleaner();
  const currentTextCleaner = isPlainObject(sharedTools.textCleaner)
    ? sharedTools.textCleaner
    : {};
  sharedTools.textCleaner = {
    ...defaultTextCleaner,
    ...currentTextCleaner,
  };
  sharedTools.sessionCrypto = {
    encryptBySessionId(payload = {}, sid = sessionId) {
      return encryptPayloadBySessionId(payload, String(sid || sessionId || ""));
    },
    decryptBySessionId(cipherText = "", sid = sessionId) {
      return decryptPayloadBySessionId(
        String(cipherText || ""),
        String(sid || sessionId || ""),
      );
    },
  };

  const connectorChannelStore = getConnectorChannelStore();
  const connectorHistoryStore = getConnectorHistoryStore();
  sharedTools.connectorChannelStore = connectorChannelStore;
  sharedTools.connectorHistoryStore = connectorHistoryStore;
  sharedTools.connectorEventListener = createConnectorEventListener({
    runtime: runtimeContext,
    store: connectorChannelStore,
    historyStore: connectorHistoryStore,
    rootSessionId,
    sessionId,
    dialogProcessId: String(runtimeContext?.systemRuntime?.dialogProcessId || "").trim(),
    allowUserInteraction: runtimeContext?.systemRuntime?.config?.allowUserInteraction !== false,
    bridge: runtimeContext?.userInteractionBridge || null,
  });
  runtimeContext.connectorChannels = rootSessionId
    ? connectorChannelStore.getSessionConnectors(rootSessionId)
    : { databases: [], terminals: [], emails: [] };

  try {
    await initRuntimeSharedBrowser(runtimeContext);
  } catch (error) {
    sharedTools.browser = null;
    sharedTools.browserInitError = error?.message || String(error);
  }
}
