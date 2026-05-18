/*
 * Noobot Harness Plugin
 * Hook-based tracing, prompt policy and run manifest for Noobot agent runtime.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const PLUGIN_NAME = "noobot-plugin-harness";
export const PLUGIN_VERSION = "0.1.0";

export const HARNESS_HOOK_POINTS = Object.freeze({
  BEFORE_CONTEXT_BUILD: "before_context_build",
  AFTER_CONTEXT_BUILD: "after_context_build",
  CONTEXT_BUILD_ERROR: "context_build_error",
  BEFORE_TURN: "before_turn",
  BEFORE_FINAL_OUTPUT: "before_final_output",
  AFTER_TURN: "after_turn",
  ON_ABORT: "on_abort",
  ON_ERROR: "on_error",
  BEFORE_LLM_CALL: "before_llm_call",
  AFTER_LLM_CALL: "after_llm_call",
  LLM_CALL_ERROR: "llm_call_error",
  BEFORE_TOOL_CALLS: "before_tool_calls",
  BEFORE_TOOL_CALL: "before_tool_call",
  AFTER_TOOL_CALL: "after_tool_call",
  TOOL_CALL_ERROR: "tool_call_error",
  BEFORE_STATE_COMMIT: "before_state_commit",
  AFTER_STATE_COMMIT: "after_state_commit",
});

const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  trace: true,
  promptPolicy: true,
  finalResponseGuard: true,
  writeContextSnapshot: true,
  writePrompts: true,
  policyMode: "warn",
  runtimeDirName: "runtime",
  harnessDirName: "harness",
  promptPriority: 80,
  tracePriority: 20,
  timeoutMs: 1000,
  maxPreviewChars: 1200,
  promptText: [
    "Noobot Harness 提醒：遵守用户隔离；附件先转文本再处理；未知规则、模板、路径、配置先读后用；最终回复保持精简且完整。",
  ].join("\n"),
  finalResponseText: [
    "最终回复请包含：做了什么、改了哪些文件、验证情况或未验证原因、下一步建议。",
  ].join("\n"),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value) {
  try {
    return JSON.stringify(value, Object.keys(value || {}).sort());
  } catch {
    return JSON.stringify(value);
  }
}

function sha256Text(text = "") {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function safeId(value = "") {
  const text = String(value || "").trim();
  return text.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

function safeError(error) {
  if (!error) return null;
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error),
    code: error?.code ? String(error.code) : undefined,
  };
}

function preview(value, maxChars = DEFAULT_OPTIONS.maxPreviewChars) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text || "").slice(0, Math.max(0, Number(maxChars) || 0));
}

function extractRuntime(ctx = {}) {
  return ctx?.agentContext?.execution?.controllers?.runtime || null;
}

function extractBasePath(ctx = {}, options = {}) {
  return String(
    options.basePath ||
      ctx.basePath ||
      extractRuntime(ctx)?.basePath ||
      ctx?.agentContext?.environment?.workspace?.basePath ||
      "",
  ).trim();
}

function extractRunId(ctx = {}) {
  return safeId(ctx.dialogProcessId || ctx?.agentContext?.execution?.dialogProcessId || ctx.sessionId || "run");
}

function createRunPaths(ctx = {}, options = {}) {
  const basePath = extractBasePath(ctx, options);
  if (!basePath) return null;
  const runId = extractRunId(ctx);
  const runDir = path.join(
    basePath,
    options.runtimeDirName || DEFAULT_OPTIONS.runtimeDirName,
    options.harnessDirName || DEFAULT_OPTIONS.harnessDirName,
    "runs",
    runId,
  );
  return {
    basePath,
    runId,
    runDir,
    manifest: path.join(runDir, "harness-run.json"),
    contextSnapshot: path.join(runDir, "context-snapshot.json"),
    events: path.join(runDir, "events.jsonl"),
    prompts: path.join(runDir, "prompts.jsonl"),
    toolCalls: path.join(runDir, "tool-calls.jsonl"),
    stateCommits: path.join(runDir, "state-commits.jsonl"),
    policyChecks: path.join(runDir, "policy-checks.json"),
  };
}

async function ensureRunDir(paths) {
  if (!paths?.runDir) return false;
  await fs.mkdir(paths.runDir, { recursive: true });
  return true;
}

async function appendJsonl(file, record) {
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildEvent(point, ctx = {}, options = {}) {
  return {
    eventId: crypto.randomUUID(),
    plugin: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    point,
    phase: ctx.phase || undefined,
    status: ctx.status || undefined,
    timestamp: nowIso(),
    userId: ctx.userId || undefined,
    sessionId: ctx.sessionId || undefined,
    parentSessionId: ctx.parentSessionId || undefined,
    dialogProcessId: ctx.dialogProcessId || ctx?.agentContext?.execution?.dialogProcessId || undefined,
    caller: ctx.caller || undefined,
    turn: ctx.turn,
    mode: ctx.mode,
    toolName: ctx.toolName,
    commitType: ctx.commitType,
    durationMs: Number.isFinite(ctx.durationMs) ? ctx.durationMs : undefined,
    success: typeof ctx.success === "boolean" ? ctx.success : undefined,
    failureReason: ctx.failureReason || undefined,
    error: safeError(ctx.error),
    preview: buildPayloadPreview(point, ctx, options),
  };
}

function buildPayloadPreview(point, ctx = {}, options = {}) {
  const maxPreviewChars = options.maxPreviewChars || DEFAULT_OPTIONS.maxPreviewChars;
  if (point === HARNESS_HOOK_POINTS.BEFORE_LLM_CALL || point === HARNESS_HOOK_POINTS.AFTER_LLM_CALL) {
    return {
      messageCount: Array.isArray(ctx.messages) ? ctx.messages.length : undefined,
      toolChoice: ctx.toolChoice,
      hasToolCalls: ctx.hasToolCalls,
      callCount: Array.isArray(ctx.calls) ? ctx.calls.length : undefined,
    };
  }
  if (point.includes("tool_call")) {
    return {
      callId: ctx.call?.id,
      argsHash: ctx.args ? sha256Text(stableStringify(ctx.args)) : undefined,
      resultPreview: ctx.toolResultText ? preview(ctx.toolResultText, maxPreviewChars) : undefined,
      resultSize: ctx.toolResultText ? String(ctx.toolResultText).length : undefined,
    };
  }
  if (point.includes("state_commit")) {
    return {
      commitType: ctx.commitType,
      payloadPreview: preview(ctx.payload, maxPreviewChars),
    };
  }
  return undefined;
}

function buildContextSnapshot(ctx = {}) {
  const agentContext = ctx.agentContext || {};
  const runtime = extractRuntime(ctx) || {};
  const systemRuntime = runtime.systemRuntime || {};
  return {
    plugin: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    createdAt: nowIso(),
    userId: ctx.userId || runtime.userId || agentContext?.environment?.identity?.userId || "",
    sessionId: ctx.sessionId || systemRuntime.sessionId || agentContext?.session?.current?.id || "",
    parentSessionId: ctx.parentSessionId || systemRuntime.parentSessionId || agentContext?.session?.parent?.id || "",
    dialogProcessId: ctx.dialogProcessId || systemRuntime.dialogProcessId || agentContext?.execution?.dialogProcessId || "",
    caller: ctx.caller || systemRuntime.caller || agentContext?.session?.parent?.caller || "",
    environment: {
      os: agentContext?.environment?.os || {},
      workspace: agentContext?.environment?.workspace || {},
    },
    execution: {
      flags: agentContext?.execution?.flags || {},
      runtimeModel: agentContext?.execution?.models?.runtimeModel || runtime.runtimeModel || "",
    },
    session: {
      attachmentCount: Array.isArray(agentContext?.session?.current?.attachments)
        ? agentContext.session.current.attachments.length
        : 0,
      connectors: agentContext?.session?.current?.connectors || {},
    },
    payload: {
      systemMessageCount: Array.isArray(agentContext?.payload?.messages?.system)
        ? agentContext.payload.messages.system.length
        : 0,
      historyMessageCount: Array.isArray(agentContext?.payload?.messages?.history)
        ? agentContext.payload.messages.history.length
        : 0,
    },
  };
}

async function updateManifest(paths, ctx = {}, patch = {}) {
  if (!paths) return;
  const current = await readJson(paths.manifest, {});
  const next = {
    plugin: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    harnessRunId: paths.runId,
    userId: ctx.userId || current.userId || "",
    sessionId: ctx.sessionId || current.sessionId || "",
    parentSessionId: ctx.parentSessionId || current.parentSessionId || "",
    dialogProcessId: ctx.dialogProcessId || current.dialogProcessId || paths.runId,
    caller: ctx.caller || current.caller || "",
    status: current.status || "running",
    startedAt: current.startedAt || ctx.startedAt || nowIso(),
    updatedAt: nowIso(),
    paths: {
      runDir: paths.runDir,
      contextSnapshot: paths.contextSnapshot,
      events: paths.events,
      prompts: paths.prompts,
      toolCalls: paths.toolCalls,
      stateCommits: paths.stateCommits,
      policyChecks: paths.policyChecks,
    },
    ...current,
    ...patch,
  };
  if (["success", "error", "abort"].includes(String(patch.status || ""))) {
    next.endedAt = patch.endedAt || nowIso();
  }
  await writeJson(paths.manifest, next);
}

function isHarnessPromptAlreadyInjected(messages = [], id = "") {
  return messages.some((msg) => {
    const content = typeof msg?.content === "string" ? msg.content : "";
    return content.includes(`<!-- ${id} -->`);
  });
}

function injectSystemMessage(ctx = {}, content = "", id = "noobot-harness") {
  if (!content) return false;
  const messages = Array.isArray(ctx.messages) ? ctx.messages : null;
  if (!messages || isHarnessPromptAlreadyInjected(messages, id)) return false;
  messages.unshift({ role: "system", content: `<!-- ${id} -->\n${content}` });
  return true;
}

async function trace(point, ctx, options) {
  if (!options.enabled || !options.trace) return;
  const paths = createRunPaths(ctx, options);
  if (!paths) return;
  await ensureRunDir(paths);
  const event = buildEvent(point, ctx, options);
  await appendJsonl(paths.events, event);
  if (point.includes("tool_call")) await appendJsonl(paths.toolCalls, event);
  if (point.includes("state_commit")) await appendJsonl(paths.stateCommits, event);
  if (point === HARNESS_HOOK_POINTS.AFTER_CONTEXT_BUILD && options.writeContextSnapshot) {
    await writeJson(paths.contextSnapshot, buildContextSnapshot(ctx));
  }
  const terminalStatus =
    point === HARNESS_HOOK_POINTS.AFTER_TURN
      ? "success"
      : point === HARNESS_HOOK_POINTS.ON_ERROR || point === HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR
        ? "error"
        : point === HARNESS_HOOK_POINTS.ON_ABORT
          ? "abort"
          : null;
  await updateManifest(paths, ctx, {
    status: terminalStatus || "running",
    updatedAt: nowIso(),
    lastEvent: { point, timestamp: event.timestamp, status: event.status },
    ...(terminalStatus ? { endedAt: nowIso(), error: safeError(ctx.error) } : {}),
  });
}

async function injectPrompt(point, ctx, options) {
  if (!options.enabled || !options.promptPolicy) return;
  const id = point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
    ? "noobot-harness-final-response"
    : "noobot-harness-policy";
  const content = point === HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT
    ? options.finalResponseText
    : options.promptText;
  const injected = injectSystemMessage(ctx, content, id);
  if (!injected || !options.writePrompts) return;
  const paths = createRunPaths(ctx, options);
  if (!paths) return;
  await ensureRunDir(paths);
  await appendJsonl(paths.prompts, {
    promptId: id,
    point,
    timestamp: nowIso(),
    contentHash: sha256Text(content),
    contentPreview: preview(content, options.maxPreviewChars),
  });
}

function resolveHookManager(api = {}) {
  return api.hookManager || api.hooks || api.manager || api?.runtime?.hookManager || api?.runConfig?.hookManager || null;
}

export function createHarnessPlugin(userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...(userOptions || {}) };
  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    options,
    register(api = {}) {
      return registerNoobotPlugin(api, options);
    },
  };
}

export function registerNoobotPlugin(api = {}, userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...(userOptions || {}), ...(api.options?.harness || {}) };
  const hookManager = resolveHookManager(api);
  if (!hookManager || typeof hookManager.on !== "function") {
    throw new Error(`${PLUGIN_NAME}: hookManager with .on(point, handler, options) is required`);
  }
  if (!options.enabled) return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers: [] };

  const disposers = [];
  const tracePoints = [
    HARNESS_HOOK_POINTS.BEFORE_CONTEXT_BUILD,
    HARNESS_HOOK_POINTS.AFTER_CONTEXT_BUILD,
    HARNESS_HOOK_POINTS.CONTEXT_BUILD_ERROR,
    HARNESS_HOOK_POINTS.BEFORE_TURN,
    HARNESS_HOOK_POINTS.AFTER_TURN,
    HARNESS_HOOK_POINTS.ON_ABORT,
    HARNESS_HOOK_POINTS.ON_ERROR,
    HARNESS_HOOK_POINTS.AFTER_LLM_CALL,
    HARNESS_HOOK_POINTS.LLM_CALL_ERROR,
    HARNESS_HOOK_POINTS.BEFORE_TOOL_CALLS,
    HARNESS_HOOK_POINTS.BEFORE_TOOL_CALL,
    HARNESS_HOOK_POINTS.AFTER_TOOL_CALL,
    HARNESS_HOOK_POINTS.TOOL_CALL_ERROR,
    HARNESS_HOOK_POINTS.BEFORE_STATE_COMMIT,
    HARNESS_HOOK_POINTS.AFTER_STATE_COMMIT,
    HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT,
  ];

  for (const point of tracePoints) {
    disposers.push(hookManager.on(point, (ctx = {}) => trace(point, ctx, options), {
      id: `${PLUGIN_NAME}.trace.${point}`,
      priority: options.tracePriority,
      timeoutMs: options.timeoutMs,
    }));
  }

  for (const point of [HARNESS_HOOK_POINTS.BEFORE_LLM_CALL, HARNESS_HOOK_POINTS.BEFORE_FINAL_OUTPUT]) {
    disposers.push(hookManager.on(point, async (ctx = {}) => {
      await injectPrompt(point, ctx, options);
      await trace(point, ctx, options);
    }, {
      id: `${PLUGIN_NAME}.prompt.${point}`,
      priority: options.promptPriority,
      timeoutMs: options.timeoutMs,
    }));
  }

  return { name: PLUGIN_NAME, version: PLUGIN_VERSION, disposers };
}

export default createHarnessPlugin;
