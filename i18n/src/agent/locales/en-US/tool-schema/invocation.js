/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const INVOCATION_TOOL_SCHEMA = {
  "call_mcp_task": {
    "description": {
      "key": "tools.mcp.description",
      "text": "Call an MCP service task. Input mcpName and task (optional modelName). Returns task execution result."
    },
    "params": {
      "mcpName": {
        "key": "tools.mcp.fieldMcpName",
        "text": "MCP service name."
      },
      "modelName": {
        "key": "tools.mcp.fieldModelName",
        "text": "Model name."
      },
      "task": {
        "key": "tools.mcp.fieldTask",
        "text": "Task description."
      }
    },
    "texts": {
      "bot.taskPrefix": "Task",
      "common.runtimeMissingBotManagerUserIdSessionId": "runtime missing botManager/userId/sessionId",
      "common.taskRequired": "task required",
      "mcp.authHeaderEmptyAfterResolve": "mcp server Authorization header is empty after env resolve",
      "mcp.fetchUnavailable": "fetch unavailable for mcp client",
      "mcp.httpError": "mcp http error",
      "mcp.inputSchemaTitle": "Input schema",
      "mcp.noToolsAvailable": "No available tools on MCP server.",
      "mcp.rpcError": "mcp rpc error",
      "mcp.serverNotFoundOrInactive": "mcp server not found or inactive",
      "mcp.sseBodyMissing": "mcp sse body missing",
      "mcp.sseConnectError": "mcp sse connect error",
      "mcp.sseEndpointMissing": "mcp sse stream ended before endpoint event",
      "mcp.ssePostError": "mcp sse post error",
      "mcp.sseRequestTimeout": "mcp sse request timeout",
      "mcp.systemPromptLine1": "You are an MCP tool execution assistant.",
      "mcp.systemPromptLine2": "You must complete tasks only with available MCP tools, and may call tools multiple times when needed.",
      "mcp.systemPromptLine3": "Finally, output a concise conclusion.",
      "mcp.toolCallTurnLimitReached": "Tool call turns reached the limit and have been stopped.",
      "mcp.toolDescriptionDefault": "MCP tool",
      "mcp.toolNotFound": "mcp tool not found",
      "tools.mcp.errorMcpNameRequired": "mcpName required"
    }
  },
  "call_service": {
    "description": {
      "key": "tools.service.description",
      "text": "Call an external service endpoint. Input serviceName and endpointName (optional queryString, body, custom_param). Returns endpoint response result."
    },
    "params": {
      "body": {
        "key": "tools.service.fieldBody",
        "text": "Request body."
      },
      "custom_param": {
        "key": "tools.service.fieldCustomParam",
        "text": "Custom parameter string."
      },
      "endpointName": {
        "key": "tools.service.fieldEndpointName",
        "text": "Endpoint name."
      },
      "queryString": {
        "key": "tools.service.fieldQueryString",
        "text": "Query parameter object."
      },
      "serviceName": {
        "key": "tools.service.fieldServiceName",
        "text": "Service name."
      }
    },
    "texts": {
      "tools.service.customParamMustBeString": "custom_param must be a string",
      "tools.service.customParamMustNotBeEmpty": "custom_param must not be empty",
      "tools.service.endpointNameRequired": "endpointName required",
      "tools.service.endpointNotFound": (params = {}) =>
    `endpoint not found: ${String(params.serviceName || "").trim()}.${String(params.endpointName || "").trim()}`,
      "tools.service.endpointUrlMissing": (params = {}) =>
    `endpoint url missing: ${String(params.serviceName || "").trim()}.${String(params.endpointName || "").trim()}`,
      "tools.service.queryStringMustBeObject": "queryString must be an object",
      "tools.service.serviceDisabled": (params = {}) =>
    `service disabled: ${String(params.serviceName || "").trim()}`,
      "tools.service.serviceNameRequired": "serviceName required",
      "tools.service.serviceNotFound": (params = {}) =>
    `service not found: ${String(params.serviceName || "").trim()}`,
      "tools.service.userIdMissing": "userId missing in context"
    }
  },
  "execute_script": {
    "description": {
      "key": "tools.script.description",
      "text": "Execute a shell script command. Input command. Returns command execution output."
    },
    "params": {
      "command": {
        "key": "tools.script.fieldCommand",
        "text": "Shell command."
      },
      "executionMode": {
        "key": "tools.script.fieldExecutionMode",
        "text": "Execution mode: foreground (default) returns stdout/stderr directly; background runs under tool management, saves stdout/stderr as attachments, and returns attachment paths. In background mode, do not add &/nohup/disown inside the command."
      },
      "includeLineNumbers": {
        "key": "tools.script.fieldIncludeLineNumbers",
        "text": "Whether stdout/stderr should include line numbers (disabled by default)."
      },
      "riskLevel": {
        "key": "tools.script.fieldRiskLevel",
        "text": "Required script risk level: low, medium, high, or critical. Destructive scripts must be marked critical."
      }
    },
    "texts": {
      "tools.script.bubblewrap.line1": "- Host root filesystem is used as lowerdir",
      "tools.script.bubblewrap.line2": "- Use runtime/sandbox/bubblewrap/overlay-upper|overlay-work under user directory as writable layer",
      "tools.script.bubblewrap.line3": "- Commands run in persistent directory /workspace/runtime/sandbox/persist, files can accumulate",
      "tools.script.bubblewrap.title": "Bubblewrap + overlayfs notes:",
      "tools.script.commandNotInstalled": (params = {}) =>
    `${String(params.commandName || "").trim()} is not installed. Please install ${String(params.commandName || "").trim()} first.`,
      "tools.script.criticalCancelled": "The critical-risk script was not confirmed by the user and execution was cancelled.",
      "tools.script.concise.lineWorkdir": (params = {}) =>
    `Default working directory: ${String(params.workdir || "").trim()}`,
      "tools.script.concise.lineRelativeBase": (params = {}) =>
    `Relative paths are resolved from: ${String(params.workdir || "").trim()}`,
      "tools.script.concise.linePaths": (params = {}) =>
    `Use only paths under ${String(params.root || "").trim()} (or relative paths).`,
      "tools.script.concise.lineExtraRoots": (params = {}) =>
    `Extra mounted roots: ${String(params.roots || "").trim()}`,
      "tools.script.commonUserInstallHint": "- For persistent software install, prefer user-space methods: npm --prefix \"$HOME/.npm-global\", pip install --user, or put binaries in $HOME/bin",
      "tools.script.docker.reuse": "- Container is auto-created on first run and reused later (not removed), so installed software can accumulate",
      "tools.script.docker.scope.global": "one shared container for all users (default)",
      "tools.script.docker.scope.user": "one container per user",
      "tools.script.docker.title": "Docker notes:",
      "tools.script.docker.mounts.title": "- Extra mounts:",
      "tools.script.docker.mounts.none": "- No extra mounts configured (no mapping when docker_mounts is empty)",
      "tools.script.docker.mounts.item": (params = {}) =>
    `  - ${String(params.source || "").trim()} -> ${String(params.target || "").trim()}${String(params.description || "").trim() ? ` (${String(params.description || "").trim()})` : ""}`,
      "tools.script.fallbackOverlaySrc": "Current bubblewrap version does not support --overlay-src. Automatically fell back to docker.",
      "tools.script.fallbackUserxattr": "Current kernel/distribution does not support bubblewrap overlay(userxattr). Automatically fell back to docker.",
      "tools.script.firejail.line1": "- Use runtime/sandbox/firejail/home under user directory as persistent HOME",
      "tools.script.firejail.line2": "- Commands run in $HOME/runtime/sandbox/persist, files can accumulate",
      "tools.script.firejail.title": "Firejail notes:",
      "tools.script.localModePathHint": "Use relative paths under this directory for input/output files.",
      "tools.script.localModeTitle": "Execute script (local mode).",
      "tools.script.localModeWorkspacePrefix": "Command runs in local directory: ",
      "tools.script.overlayDirNotWritable": (params = {}) =>
    `bubblewrap overlay directory is not writable. Check permissions (suggestion: sudo chown -R $(id -u):$(id -g) "${String(params.sandboxRoot || "").trim()}"). ${String(params.reason || "").trim()}`,
      "tools.script.overlaySrcUnsupported": "Current bubblewrap version does not support --overlay-src. Upgrade bubblewrap, or switch tools.execute_script.sandbox_provider.default to docker.",
      "tools.script.sandboxModeTitlePrefix": "Execute script (sandbox mode, provider=",
      "tools.script.sandboxModeTitleSuffix": ").",
      "tools.script.userxattrUnsupported": (params = {}) =>
    `${String(params.stderr || "")}\nCurrent system does not support bubblewrap overlay(userxattr). Use tools.execute_script.sandbox_provider.default=docker, or upgrade kernel with CONFIG_OVERLAY_FS_USERXATTR enabled.`,
      "tools.script.workdir.bubblewrap.line1": "- Default working directory: /workspace/runtime/sandbox/persist",
      "tools.script.workdir.commonPathHint": "Use relative paths under this directory or paths under /workspace for input/output files.",
      "tools.script.workdir.docker.global.line1": "- Default working directory: /workspace/<userId>/runtime/ops_workdir",
      "tools.script.workdir.docker.user.line1": "- Default working directory: /workspace/runtime/ops_workdir",
      "tools.script.workdir.firejail.line1": "- Default working directory: $HOME/runtime/sandbox/persist",
      "tools.script.workdir.firejail.line2": "Use relative paths under this directory or paths under $HOME for input/output files."
    }
  },
};
