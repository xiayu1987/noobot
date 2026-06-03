import {
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_PLUGIN_DEFAULTS,
  WORKFLOW_SEMANTIC,
} from "./constants.js";

const DEFAULT_SEMANTIC_PROMPT = [
  "你是工作流语义编译器。",
  "请输出纯文本 DSL 协议，不要 JSON，不要 markdown。",
  "协议头必须为：WORKFLOW_DSL/1",
  "每行一条指令，仅允许 NODE/EDGE/AUTO/END。",
  "示例:",
  "WORKFLOW_DSL/1",
  "NODE id=start type=state stateType=start name=\"开始\"",
  "NODE id=audit type=action name=\"审批\"",
  "NODE id=end type=state stateType=end name=\"结束\"",
  "EDGE from=start to=audit name=\"开始到审批\"",
  "EDGE from=audit to=end name=\"审批到结束\"",
  "AUTO type=submit stepIndex=0",
  "END",
  "规则:",
  "- NODE 必须包含 id/type，state 节点可带 stateType。",
  "- EDGE 必须包含 from/to，且节点 id 必须存在。",
  "- AUTO type 仅允许 submit|audit|back|stop。",
].join("\n");

export function normalizeOptions(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const mode = String(source?.mode ?? WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF).trim().toLowerCase();
  const maxAutoTransitions = Number(source?.maxAutoTransitions);
  const miniRunnerMaxTurns = Number(source?.miniRunnerMaxTurns);

  return {
    enabled: source?.enabled !== false,
    mode: mode === WORKFLOW_PLUGIN_DEFAULTS.MODE_ON ? WORKFLOW_PLUGIN_DEFAULTS.MODE_ON : WORKFLOW_PLUGIN_DEFAULTS.MODE_OFF,
    hookPoint: WORKFLOW_BOT_HOOK_POINTS.AFTER_AGENT_DISPATCH,
    semanticMode: String(source?.semanticMode || WORKFLOW_SEMANTIC.MODE_SEPARATE_MODEL).trim().toLowerCase(),
    semanticPrompt:
      typeof source?.semanticPrompt === "string" && source.semanticPrompt.trim()
        ? source.semanticPrompt.trim()
        : DEFAULT_SEMANTIC_PROMPT,
    semanticModel: String(source?.semanticModel || "").trim(),
    workflowProjectPath: String(source?.workflowProjectPath || "").trim(),
    maxAutoTransitions:
      Number.isFinite(maxAutoTransitions) && maxAutoTransitions > 0
        ? Math.floor(maxAutoTransitions)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS,
    autoSubmit: source?.autoSubmit !== false,
    miniRunnerMaxTurns:
      Number.isFinite(miniRunnerMaxTurns) && miniRunnerMaxTurns > 0
        ? Math.min(Math.floor(miniRunnerMaxTurns), 5)
        : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MINI_RUNNER_MAX_TURNS,
    capabilityModelInvoker:
      typeof source?.capabilityModelInvoker === "function"
        ? source.capabilityModelInvoker
        : null,
  };
}
