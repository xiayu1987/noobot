/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { initRuntimeSharedBrowser } from "../../utils/web/browser-simulate.js";
import { isPlainObject } from "../../utils/shared-utils.js";
import {
  cleanAndDedupTextLines,
  extractReadableTextFromHtml,
  extractVisibleTextFromHtml,
} from "../../utils/web/text-cleaner.js";
import { cleanTextUniversal } from "../../utils/text-cleaner.js";
import {
  decryptPayloadBySessionId,
  encryptPayloadBySessionId,
} from "../../utils/session-crypto.js";
import { getConnectorChannelStore } from "../../connectors/index.js";
import { getConnectorHistoryStore } from "../../connectors/index.js";
import { createConnectorEventListener } from "../../connectors/index.js";
import {
  createCurrentTurnMessagesStore,
  createCurrentTurnTasksStore,
} from "../session/current-turn-store.js";
import { resolveDialogProcessIdFromContext } from "../session/dialog-process-id-resolver.js";
import {
  resolveAttachmentDisplayPath,
  resolveSandboxPath,
} from "../../utils/sandbox-path-resolver.js";
import {
  directInput,
  directOutput,
  fileInput,
  fileOutput,
  getPrimaryTransferFile,
  getTransferAttachmentMetas,
  getTransferDisplayPath,
  getTransferFiles,
  materializeOutput,
  materializeOutputResult,
  normalizeTransfer,
  normalizeTransferPolicy,
  isValidTransferEnvelope,
  persistTransferArtifacts,
  persistTransferFile,
  resolveTransferFilePath,
  validateTransferEnvelope,
} from "../../semantic-transfer/index.js";


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
  const runtimeHookManager =
    runConfig?.hookManager && typeof runConfig.hookManager === "object"
      ? runConfig.hookManager
      : null;
  const runtimeHooks =
    runConfig?.hooks && typeof runConfig.hooks === "object"
      ? runConfig.hooks
      : null;
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
    runConfig:
      runConfig && typeof runConfig === "object" && !Array.isArray(runConfig)
        ? runConfig
        : {},
    allEnabledProviders:
      allEnabledProviders && typeof allEnabledProviders === "object"
        ? allEnabledProviders
        : {},
    sharedTools: passthroughSharedTools,
    hookManager: runtimeHookManager,
    hooks: runtimeHooks,
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

function ensureSharedTools(runtimeContext = {}) {
  const sharedTools = isPlainObject(runtimeContext.sharedTools)
    ? runtimeContext.sharedTools
    : {};
  runtimeContext.sharedTools = sharedTools;
  return sharedTools;
}

function initializeSharedFetch(sharedTools = {}) {
  if (typeof sharedTools.fetch !== "function") {
    sharedTools.fetch =
      typeof globalThis.fetch === "function" ? defaultSharedFetch : null;
  }
}

function initializeTextCleaner(sharedTools = {}) {
  const defaultTextCleaner = createDefaultTextCleaner();
  const currentTextCleaner = isPlainObject(sharedTools.textCleaner)
    ? sharedTools.textCleaner
    : {};
  sharedTools.textCleaner = {
    ...defaultTextCleaner,
    ...currentTextCleaner,
  };
}

function initializeSessionCrypto(sharedTools = {}, { sessionId = "" } = {}) {
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
}

function initializeSemanticTransfer(runtimeContext = {}, sharedTools = {}) {
  const currentSemanticTransfer = isPlainObject(sharedTools.semanticTransfer)
    ? sharedTools.semanticTransfer
    : {};
  sharedTools.semanticTransfer = {
    directInput,
    fileInput,
    directOutput,
    fileOutput,
    getTransferFiles: (value, options = {}) =>
      getTransferFiles(value, {
        ...(options && typeof options === "object" ? options : {}),
        runtime: options?.runtime || runtimeContext,
        agentContext: options?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    getPrimaryTransferFile: (value, options = {}) =>
      getPrimaryTransferFile(value, {
        ...(options && typeof options === "object" ? options : {}),
        runtime: options?.runtime || runtimeContext,
        agentContext: options?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    getTransferDisplayPath: (value, options = {}) =>
      getTransferDisplayPath(value, {
        ...(options && typeof options === "object" ? options : {}),
        runtime: options?.runtime || runtimeContext,
        agentContext: options?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    getTransferAttachmentMetas,
    normalizeTransfer: (value, options = {}) =>
      normalizeTransfer(value, {
        ...(options && typeof options === "object" ? options : {}),
        runtime: options?.runtime || runtimeContext,
        agentContext: options?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    resolveTransferFilePath: (payload = {}) =>
      resolveTransferFilePath({
        ...(payload && typeof payload === "object" ? payload : { path: String(payload || "") }),
        runtime: payload?.runtime || runtimeContext,
        agentContext: payload?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    persistTransferArtifacts: (payload = {}) =>
      persistTransferArtifacts({
        ...(payload && typeof payload === "object" ? payload : {}),
        runtime: payload?.runtime || runtimeContext,
        agentContext: payload?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    persistTransferFile: (payload = {}) =>
      persistTransferFile({
        ...(payload && typeof payload === "object" ? payload : {}),
        runtime: payload?.runtime || runtimeContext,
        agentContext: payload?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    normalizeTransferPolicy,
    validateTransferEnvelope,
    isValidTransferEnvelope,
    materializeOutputResult: (payload = {}) =>
      materializeOutputResult({
        ...(payload && typeof payload === "object" ? payload : { content: String(payload || "") }),
        runtime: payload?.runtime || runtimeContext,
        agentContext: payload?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    materializeOutput: (payload = {}) =>
      materializeOutput({
        ...(payload && typeof payload === "object" ? payload : { content: String(payload || "") }),
        runtime: payload?.runtime || runtimeContext,
        agentContext: payload?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }),
    ...currentSemanticTransfer,
  };
}

function initializeSandboxPathResolver(runtimeContext = {}, sharedTools = {}) {
  const existingResolver =
    typeof sharedTools.resolveSandboxPath === "function" ? sharedTools.resolveSandboxPath : null;
  const resolver =
    existingResolver ||
    ((payload = {}) =>
      resolveSandboxPath({
        ...payload,
        runtime: payload?.runtime || runtimeContext,
        agentContext: payload?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      }));
  sharedTools.resolveSandboxPath = resolver;
  if (typeof sharedTools.resolveAttachmentDisplayPath !== "function") {
    sharedTools.resolveAttachmentDisplayPath = (payload = {}) =>
      resolveAttachmentDisplayPath({
        ...(payload && typeof payload === "object" ? payload : { path: String(payload || "") }),
        runtime: payload?.runtime || runtimeContext,
        agentContext: payload?.agentContext || runtimeContext?.systemRuntime?.agentContext || null,
      });
  }
  if (typeof sharedTools.toSandboxPath !== "function") {
    sharedTools.toSandboxPath = (payload = {}) =>
      resolver(
        payload && typeof payload === "object"
          ? payload
          : { path: String(payload || "") },
      );
  }
  const currentPathMapper =
    sharedTools.pathMapper && typeof sharedTools.pathMapper === "object"
      ? sharedTools.pathMapper
      : {};
  sharedTools.pathMapper = {
    ...currentPathMapper,
    toSandboxPath:
      typeof currentPathMapper.toSandboxPath === "function"
        ? currentPathMapper.toSandboxPath
        : sharedTools.toSandboxPath,
  };
}

function initializeUserInteractionBridgeCrypto(runtimeContext = {}, sharedTools = {}) {
  const bridge = runtimeContext?.userInteractionBridge;
  if (!bridge || typeof bridge.requestUserInteraction !== "function") return;
  if (bridge.__sessionCryptoWrapped === true) return;
  const decryptBySessionId = sharedTools?.sessionCrypto?.decryptBySessionId;
  if (typeof decryptBySessionId !== "function") return;

  const originalRequestUserInteraction = bridge.requestUserInteraction.bind(bridge);
  bridge.requestUserInteraction = async function wrappedRequestUserInteraction(payload = {}) {
    const result = await originalRequestUserInteraction(payload);
    if (payload?.requireEncryption !== true) return result;

    const encryptedPayload = result?.payload;
    const encryptedFlag = result?.encrypted === true;
    const fallbackSessionId = String(payload?.sessionId || "").trim();
    const responseSessionId = String(result?.sessionId || "").trim();
    const targetSessionId = responseSessionId || fallbackSessionId;
    if (!encryptedFlag || !String(encryptedPayload || "").trim() || !targetSessionId) {
      throw new Error("encrypted interaction response required");
    }
    return decryptBySessionId(String(encryptedPayload || ""), targetSessionId);
  };
  bridge.__sessionCryptoWrapped = true;
}

function initializeConnectorRuntime(
  runtimeContext = {},
  sharedTools = {},
  { rootSessionId = "", sessionId = "" } = {},
) {
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
    dialogProcessId: resolveDialogProcessIdFromContext({ runtime: runtimeContext }),
    allowUserInteraction: runtimeContext?.systemRuntime?.config?.allowUserInteraction !== false,
    bridge: runtimeContext?.userInteractionBridge || null,
  });
  runtimeContext.connectorChannels = rootSessionId
    ? connectorChannelStore.getSessionConnectors(rootSessionId)
    : { databases: [], terminals: [], emails: [] };
}

async function initializeBrowserRuntime(runtimeContext = {}, sharedTools = {}) {
  try {
    await initRuntimeSharedBrowser(runtimeContext);
  } catch (error) {
    sharedTools.browser = null;
    sharedTools.browserInitError = error?.message || String(error);
  }
}

export async function initializeRuntimeEnvironment(runtimeContext = {}) {
  if (!isPlainObject(runtimeContext)) return;
  const sharedTools = ensureSharedTools(runtimeContext);
  const sessionId = String(runtimeContext?.systemRuntime?.sessionId || "").trim();
  const rootSessionId = String(
    runtimeContext?.systemRuntime?.rootSessionId || sessionId || "",
  ).trim();

  initializeSharedFetch(sharedTools);
  initializeTextCleaner(sharedTools);
  initializeSessionCrypto(sharedTools, { sessionId });
  initializeSemanticTransfer(runtimeContext, sharedTools);
  initializeSandboxPathResolver(runtimeContext, sharedTools);
  initializeUserInteractionBridgeCrypto(runtimeContext, sharedTools);
  initializeConnectorRuntime(runtimeContext, sharedTools, { rootSessionId, sessionId });
  await initializeBrowserRuntime(runtimeContext, sharedTools);
}
