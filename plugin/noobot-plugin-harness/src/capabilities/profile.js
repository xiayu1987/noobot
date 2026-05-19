export const HARNESS_ENGINEERING_CAPABILITIES = Object.freeze([
  "planning",
  "guidance",
  "acceptance",
  "review",
]);

function createCapabilityState() {
  return {
    enabled: true,
    mode: "planned",
    priority: 0,
    takeoverPriority: 0,
    owner: "harness-plugin",
    notes: "capability contract declared; implementation pending",
    scope: "general",
    toolTakeover: {
      enabled: false,
      mode: "observe",
      allowToolNames: [],
      denyToolNames: [],
    },
    messageTakeover: {
      enabled: false,
      mode: "prepend",
      role: "system",
      target: "auto",
      dedupe: true,
    },
    memoryTakeover: {
      enabled: false,
      mode: "observe",
      priority: 0,
      priorityByCommitType: {},
      allowCommitTypes: [],
      blockCommitTypes: [],
      stripPayloadKeys: [],
    },
  };
}

export function createDefaultCapabilityProfile() {
  return HARNESS_ENGINEERING_CAPABILITIES.reduce((acc, capability) => {
    const base = createCapabilityState();
    if (capability === "planning") {
      acc[capability] = {
        ...base,
        phases: ["goal", "decompose", "prioritize"],
        scope: "plan_and_decompose",
      };
      return acc;
    }
    if (capability === "acceptance") {
      acc[capability] = {
        ...base,
        scope: "task_acceptance_and_gate",
        toolTakeover: {
          ...base.toolTakeover,
          enabled: true,
          mode: "policy_guardrail",
        },
      };
      return acc;
    }
    acc[capability] = base;
    return acc;
  }, {});
}

export function resolveCapabilityProfile(profile = {}) {
  const incoming = profile && typeof profile === "object" ? profile : {};
  const fallback = createDefaultCapabilityProfile();
  return HARNESS_ENGINEERING_CAPABILITIES.reduce((acc, capability) => {
    const next = incoming[capability] && typeof incoming[capability] === "object"
      ? incoming[capability]
      : {};
    acc[capability] = {
      ...fallback[capability],
      ...next,
    };
    return acc;
  }, {});
}
