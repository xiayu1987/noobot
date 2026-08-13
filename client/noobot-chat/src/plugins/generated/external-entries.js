/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const externalFrontendPluginEntries = [
  {
    pluginId: "harness",
    name: "noobot-plugin-harness",
    version: "4.1.7",
    manifest: Object.freeze({"protocolVersion":2,"id":"harness","name":"noobot-plugin-harness","version":"4.1.7","entries":{"agent":"src/entries/agent.js","service":"src/entries/service.js","frontend":"frontend/index.js"},"contributes":{"agent":{"hooks":{"registers":["agent.before_context_build","agent.after_context_build","agent.context_build_error","agent.before_turn","agent.after_turn","agent.on_abort","agent.on_error","agent.before_llm_call","agent.after_llm_call","agent.llm_call_error","agent.before_tool_calls","agent.after_tool_calls","agent.before_tool_call","agent.after_tool_call","agent.tool_call_error","agent.before_state_commit","agent.after_state_commit","agent.before_final_output"],"emits":[]}},"service":{"hooks":{"registers":["service.after_session_delete"],"emits":[]}},"frontend":{"extensions":[{"id":"harness-legacy-collapse-marker","point":"markdown.collapse.markers"},{"id":"harness-model-extension","point":"composer.options.model"},{"id":"thinking-panel","point":"message.card.pre"}]}},"requires":{"ports":["hooks.register","policy.patch","model.invoke","artifacts.write","events.emit","authenticated_request","frontend.contribute"],"permissions":["model.invoke","artifact.write","session.delete.observe","http.authenticated"],"authenticatedRoutes":["/api/internal/session/:userId/:sessionId/thinking-detail"]},"enabledByDefault":true}),
    loadModule: () => import("../../../../../plugin/noobot-plugin-harness/frontend/index.js"),
  },
  {
    pluginId: "workflow",
    name: "noobot-plugin-workflow",
    version: "4.1.7",
    manifest: Object.freeze({"protocolVersion":2,"id":"workflow","name":"noobot-plugin-workflow","version":"4.1.7","entries":{"agent":"src/entries/agent.js","service":"src/entries/service.js","frontend":"frontend/index.js"},"contributes":{"agent":{"hooks":{"registers":["bot.before_agent_dispatch"],"emits":["workflow.node_agent_execute"]},"executionIntent":{"kind":"workflow","idPrefix":"workflow","originType":"workflow","originIdKey":"workflowRunId","stage":"planning"}},"service":{"hooks":{"registers":["service.after_session_delete"],"emits":[]},"routes":[{"id":"workflow.detail","method":"GET","paths":["/internal/workflow/session/:userId/:sessionId/:dialogProcessId","/api/internal/workflow/session/:userId/:sessionId/:dialogProcessId"],"auth":"connected_user"},{"id":"workflow.thinking-detail","method":"GET","paths":["/internal/workflow/session/:userId/:sessionId/:dialogProcessId/thinking-detail","/api/internal/workflow/session/:userId/:sessionId/:dialogProcessId/thinking-detail"],"auth":"connected_user"}]},"frontend":{"extensions":[{"id":"workflow-model-extension","point":"composer.options.model"},{"id":"workflow-card","point":"message.card.pre"},{"id":"workflow-session-detail-hydrator","point":"session.detail.hydrator"},{"id":"workflow-runtime-projector","point":"runtime.stream.route"}]}},"requires":{"ports":["hooks.register","hooks.emit","policy.patch","model.invoke","artifacts.write","events.emit","routes.bind","authenticated_request","frontend.contribute"],"permissions":["session.read","session.child.create","session.delete.observe","model.invoke","artifact.write","http.authenticated"],"authenticatedRoutes":["/api/internal/workflow/session/:userId/:sessionId/:nodeDialogProcessId","/api/internal/workflow/session/:userId/:sessionId/:nodeDialogProcessId/thinking-detail"]},"enabledByDefault":true}),
    loadModule: () => import("../../../../../plugin/noobot-plugin-workflow/frontend/index.js"),
  }
];
