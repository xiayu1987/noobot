/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { initRuntimeSharedBrowser } from "../../shared/utils/web/browser-simulate.js";
import { isPlainObject } from "../../shared/utils/shared-utils.js";
import {
  cleanAndDedupTextLines,
  extractReadableTextFromHtml,
  extractVisibleTextFromHtml,
} from "../../shared/utils/web/text-cleaner.js";
import { cleanTextUniversal } from "../../shared/utils/text-cleaner.js";
import {
  decryptPayloadBySessionId,
  encryptPayloadBySessionId,
} from "../../shared/utils/session-crypto.js";
import {
  getConnectorChannelStore,
  getConnectorRegistry,
} from "../../integrations/connectors/index.js";
import {
  resolveRuntimeTransferIdentity,
  transferSemanticContent,
} from "../../transfer-adapter/index.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { fetch as undiciFetch } from "undici";

async function defaultSharedFetch(url, init = {}) {
  return await undiciFetch(url, init);
}

function createDefaultTextCleaner() {
  return {
    cleanUniversal(input = "", options = {}) {
      return cleanTextUniversal(input, options || {});
    },
    cleanText(input = "", maxLines = QUANTITY_THRESHOLDS.web.textMaxLines) {
      return cleanAndDedupTextLines(String(input || ""), maxLines);
    },
    cleanHtml(input = "", { url = "", readable = false } = {}) {
      const html = String(input || "");
      if (!html) return "";
      if (readable) {
        return (
          extractReadableTextFromHtml(html, String(url || "")) || extractVisibleTextFromHtml(html)
        );
      }
      return extractVisibleTextFromHtml(html);
    },
    cleanAny(input = "", { contentType = "", url = "" } = {}) {
      return cleanTextUniversal(String(input || ""), {
        format: "auto",
        contentType: String(contentType || ""),
        url: String(url || ""),
        maxChars: LENGTH_THRESHOLDS.toolIO.runtimeCleanAnyChars,
      });
    },
  };
}

function ensureSharedTools(runtimeContext = {}) {
  const sharedTools = isPlainObject(runtimeContext.sharedTools) ? runtimeContext.sharedTools : {};
  runtimeContext.sharedTools = sharedTools;
  return sharedTools;
}

function initializeSharedFetch(sharedTools = {}) {
  if (typeof sharedTools.fetch !== "function") {
    sharedTools.fetch = defaultSharedFetch;
  }
}

function initializeTextCleaner(sharedTools = {}) {
  const defaultTextCleaner = createDefaultTextCleaner();
  const currentTextCleaner = isPlainObject(sharedTools.textCleaner) ? sharedTools.textCleaner : {};
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
      return decryptPayloadBySessionId(String(cipherText || ""), String(sid || sessionId || ""));
    },
  };
}

function resolveSharedToolRuntime(runtimeContext = {}, payloadRuntime = null) {
  if (!isPlainObject(payloadRuntime)) return runtimeContext;
  return {
    ...runtimeContext,
    ...payloadRuntime,
    systemRuntime: {
      ...(isPlainObject(runtimeContext?.systemRuntime) ? runtimeContext.systemRuntime : {}),
      ...(isPlainObject(payloadRuntime?.systemRuntime) ? payloadRuntime.systemRuntime : {}),
    },
  };
}

function resolveSharedToolAgentContext(runtimeContext = {}, payload = {}) {
  return (
    payload?.agentContext ||
    payload?.runtime?.systemRuntime?.agentContext ||
    runtimeContext?.systemRuntime?.agentContext ||
    null
  );
}

function initializeSemanticTransfer(runtimeContext = {}, sharedTools = {}) {
  sharedTools.semanticTransfer = {
    resolveIdentity: (payload = {}) => {
      const runtime = resolveSharedToolRuntime(runtimeContext, payload?.runtime);
      return resolveRuntimeTransferIdentity({ ...payload, runtime });
    },
    transferSemanticContent: (payload = {}) => {
      const runtime = resolveSharedToolRuntime(runtimeContext, payload?.runtime);
      const identity = resolveRuntimeTransferIdentity({
        runtime,
        sessionId: payload?.sessionId,
        producer: payload?.producer,
        direction: payload?.direction,
        strategy: payload?.strategy,
        transferKey: payload?.transferKey,
      });
      return transferSemanticContent({
        ...(payload && typeof payload === "object" ? payload : {}),
        identity,
        runtime,
        agentContext: resolveSharedToolAgentContext(runtimeContext, payload),
      });
    },
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

function initializeConnectorRuntime(runtimeContext = {}, sharedTools = {}) {
  const connectorChannelStore = getConnectorChannelStore();
  sharedTools.connectorChannelStore = connectorChannelStore;
  sharedTools.connectorRegistry = getConnectorRegistry({ required: false });
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

  initializeSharedFetch(sharedTools);
  initializeTextCleaner(sharedTools);
  initializeSessionCrypto(sharedTools, { sessionId });
  initializeSemanticTransfer(runtimeContext, sharedTools);
  initializeUserInteractionBridgeCrypto(runtimeContext, sharedTools);
  initializeConnectorRuntime(runtimeContext, sharedTools);
  await initializeBrowserRuntime(runtimeContext, sharedTools);
}
