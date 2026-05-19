import { ensureTaskAcceptanceTool } from "./acceptance.js";
import {
  CAPABILITY_DOMAIN,
  LLM_SUMMARY_THRESHOLD,
  LOCALE,
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  defaultTaskChecklist,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
  extractRawTextContent,
  getDefaultTaskOwner,
  getTaskTemplate,
  parseTaskChecklistFromModelOutput,
  relaySeparateModelOutputAsUserMessage,
  resolveCapabilityModelInvoker,
  resolvePlanningToolAllowlist,
  resolveSceneToolNames,
  safeJsonStringify,
  sanitizeInternalMessages,
  shouldUseSeparateModel,
  t,
} from "./shared.js";

function maybeInjectPlanningPrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  if (state.flags.planningPromptInjected === true) return false;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;
  messages.unshift({
    role: "system",
    content: [
      t(locale, "planningPromptMarker"),
      t(locale, "planningPromptLine1"),
      t(locale, "planningPromptLine2", {
        example: `{"taskOwner":"${getDefaultTaskOwner(locale)}","taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}"}]}`,
      }),
      t(locale, "planningPromptLine3"),
      t(locale, "planningPromptLine4"),
    ].join("\n"),
  });
  state.flags.planningPromptInjected = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_prompt_injected",
  });
  return true;
}

function enablePlanningForceToolRetry(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (state.flags.planningForceToolTemporarilyEnabled === true) return false;
  const runtimeConfig = ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.config;
  if (!runtimeConfig || typeof runtimeConfig !== "object") return false;
  state.flags.planningForceToolOriginalSet = Object.prototype.hasOwnProperty.call(runtimeConfig, "forceTool");
  state.flags.planningForceToolOriginal = Boolean(runtimeConfig?.forceTool);
  runtimeConfig.forceTool = true;
  state.flags.planningForceToolTemporarilyEnabled = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_force_tool_retry_enabled",
  });
  return true;
}

function restorePlanningForceToolRetry(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (state.flags.planningForceToolTemporarilyEnabled !== true) return false;
  const runtimeConfig = ctx?.agentContext?.execution?.controllers?.runtime?.systemRuntime?.config;
  if (!runtimeConfig || typeof runtimeConfig !== "object") return false;
  if (state.flags.planningForceToolOriginalSet === true) {
    runtimeConfig.forceTool = Boolean(state.flags.planningForceToolOriginal);
  } else {
    delete runtimeConfig.forceTool;
  }
  state.flags.planningForceToolTemporarilyEnabled = false;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_force_tool_retry_restored",
  });
  return true;
}

async function runPlanningBySeparateModel(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (
    String(bucket?.taskChecklistSource || "").trim().toLowerCase() === "model" &&
    Array.isArray(bucket?.taskChecklist) &&
    bucket.taskChecklist.length
  ) {
    state.flags.planningCaptured = true;
    return false;
  }
  const invoker = resolveCapabilityModelInvoker(meta);
  if (!invoker) return false;
  const locale = state?.locale || LOCALE.ZH_CN;
  const planningMessages = Array.isArray(ctx?.messages) ? [...ctx.messages] : [];
  planningMessages.unshift({
    role: "system",
    content:
      locale === LOCALE.EN_US
        ? `Context input (ctx) for planning. Must be fully considered:\n\`\`\`json\n${safeJsonStringify(ctx)}\n\`\`\``
        : `规划输入上下文(ctx)如下，必须完整参考：\n\`\`\`json\n${safeJsonStringify(ctx)}\n\`\`\``,
  });
  const planningPrompt = [
    t(locale, "planningPromptLine1"),
    t(locale, "planningPromptLine2", {
      example: `{"taskOwner":"${getDefaultTaskOwner(locale)}","taskChecklist":[{"index":1,"task":"${getTaskTemplate(locale).PARSE_ATTACHMENT}","owner":"${getDefaultTaskOwner(locale)}"}]}`,
    }),
    t(locale, "planningPromptLine3"),
    t(locale, "planningPromptLine4"),
    "",
    JSON.stringify(
      {
        sceneTools: resolveSceneToolNames(ctx),
        toolAllowlist: resolvePlanningToolAllowlist(meta),
      },
      null,
      2,
    ),
  ].join("\n");
  let response = null;
  try {
    response = await invoker({
      purpose: "planning",
      domain: CAPABILITY_DOMAIN.PLANNING,
      locale,
      prompt: planningPrompt,
      messages: planningMessages,
      ctx,
      toolAllowlist: resolvePlanningToolAllowlist(meta),
    });
  } catch (error) {
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.PLANNING,
      event: "planning_separate_model_call_failed",
      detail: { error: String(error?.message || error || "") },
    });
    return false;
  }
  await appendCapabilityModelTraceLog(ctx, meta, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    purpose: "planning",
    response,
  });
  const responseText =
    extractRawTextContent(response?.content) ||
    String(response?.text || response?.output || "").trim();
  const parsed = parseTaskChecklistFromModelOutput(responseText, locale);
  if (parsed.length) {
    bucket.taskChecklist = parsed;
    bucket.taskChecklistSource = "model";
  } else if (!Array.isArray(bucket.taskChecklist) || !bucket.taskChecklist.length) {
    bucket.taskChecklist = defaultTaskChecklist(locale);
    bucket.taskChecklistSource = "default";
  } else if (!String(bucket?.taskChecklistSource || "").trim()) {
    bucket.taskChecklistSource = "existing";
  }
  bucket.taskOwner = getDefaultTaskOwner(locale);
  state.flags.planningCaptured = true;
  relaySeparateModelOutputAsUserMessage(ctx, {
    locale,
    purpose: "planning",
    content: responseText,
  });
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_captured_by_separate_model",
    detail: {
      checklistCount: Array.isArray(bucket.taskChecklist) ? bucket.taskChecklist.length : 0,
      source: String(bucket?.taskChecklistSource || "").trim() || (parsed.length ? "model" : "default"),
    },
  });
  return true;
}

function maybeCapturePlanningResult(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  if (state.flags.planningCaptured === true) return false;
  if (state.flags.planningPromptInjected !== true) return false;
  const sourceContent =
    extractRawTextContent(ctx?.ai?.content) ||
    extractRawTextContent(ctx?.modelResponse?.content) ||
    "";
  const locale = state?.locale || LOCALE.ZH_CN;
  const parsed = parseTaskChecklistFromModelOutput(sourceContent, locale);
  bucket.taskChecklist = parsed.length ? parsed : defaultTaskChecklist(locale);
  bucket.taskOwner = getDefaultTaskOwner(locale);
  state.flags.planningCaptured = true;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "planning_checklist_captured",
    detail: { checklistCount: bucket.taskChecklist.length, source: parsed.length ? "model" : "default" },
  });
  return true;
}

export function createPlanningHandler() {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (point === "before_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder) {
        holder.state.counters.llmTurns += 1;
        if (holder.state.counters.llmTurns > LLM_SUMMARY_THRESHOLD) {
          holder.state.pending.summary = true;
        }
      }
      changed = sanitizeInternalMessages(ctx) || changed;
      changed = disableBlockedToolsInRegistry(ctx) || changed;
      changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
      if (shouldUseSeparateModel(meta)) {
        changed = (await runPlanningBySeparateModel(ctx, meta)) || changed;
      } else {
        changed = maybeInjectPlanningPrompt(ctx) || changed;
      }
    }
    if (point === "after_llm_call") {
      changed = maybeCapturePlanningResult(ctx) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}

export {
  enablePlanningForceToolRetry,
  restorePlanningForceToolRetry,
};
