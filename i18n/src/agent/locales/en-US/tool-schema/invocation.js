/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const INVOCATION_TOOL_SCHEMA = {
  call_mcp_task: {
    description: {
      key: "tools.mcp.description",
      text: "Call an MCP service task. Input mcpName and task (optional modelName). Returns task execution result.",
    },
    params: {
      mcpName: {
        key: "tools.mcp.fieldMcpName",
        text: "MCP service name.",
      },
      modelName: {
        key: "tools.mcp.fieldModelName",
        text: "Model name.",
      },
      task: {
        key: "tools.mcp.fieldTask",
        text: "Task description.",
      },
    },
    texts: {
      "bot.taskPrefix": "Task",
      "common.runtimeMissingBotManagerUserIdSessionId":
        "runtime missing botManager/userId/sessionId",
      "common.taskRequired": "task required",
      "mcp.authHeaderEmptyAfterResolve":
        "mcp server Authorization header is empty after env resolve",
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
      "mcp.systemPromptLine2":
        "You must complete tasks only with available MCP tools, and may call tools multiple times when needed.",
      "mcp.systemPromptLine3": "Finally, output a concise conclusion.",
      "mcp.toolCallTurnLimitReached": "Tool call turns reached the limit and have been stopped.",
      "mcp.toolDescriptionDefault": "MCP tool",
      "mcp.toolNotFound": "mcp tool not found",
      "tools.mcp.errorMcpNameRequired": "mcpName required",
    },
  },
  call_service: {
    description: {
      key: "tools.service.description",
      text: "Call an external service endpoint. Input serviceName and endpointName (optional queryString, body, custom_param). Returns endpoint response result.",
    },
    params: {
      body: {
        key: "tools.service.fieldBody",
        text: "Request body.",
      },
      custom_param: {
        key: "tools.service.fieldCustomParam",
        text: "Custom parameter string.",
      },
      endpointName: {
        key: "tools.service.fieldEndpointName",
        text: "Endpoint name.",
      },
      queryString: {
        key: "tools.service.fieldQueryString",
        text: "Query parameter object.",
      },
      serviceName: {
        key: "tools.service.fieldServiceName",
        text: "Service name.",
      },
    },
    texts: {
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
      "tools.service.userIdMissing": "userId missing in context",
    },
  },
  execute_script: {
    description: {
      key: "tools.script.description",
      text: "Execute a shell script command. Input command. Returns command execution output.",
    },
    params: {
      command: {
        key: "tools.script.fieldCommand",
        text: "Shell command.",
      },
      executionMode: {
        key: "tools.script.fieldExecutionMode",
        text: "Execution mode: foreground (default) waits for completion and returns stdout/stderr directly; background also waits for completion, but keeps stdout/stderr under tool management and returns them as attachments afterward. Background does not return early; do not add &/nohup/disown inside the command.",
      },
      includeLineNumbers: {
        key: "tools.script.fieldIncludeLineNumbers",
        text: "Whether stdout/stderr should include line numbers (disabled by default).",
      },
      riskLevel: {
        key: "tools.script.fieldRiskLevel",
        text: "Required script risk level: low, medium, high, or critical. Destructive scripts must be marked critical.",
      },
    },
    texts: {
      "tools.script.commandNotInstalled": (params = {}) =>
        `${String(params.commandName || "").trim()} is not installed. Please install ${String(params.commandName || "").trim()} first.`,
      "tools.script.criticalCancelled":
        "The critical-risk script was not confirmed by the user and execution was cancelled.",
      "tools.script.concise.lineWorkdir": (params = {}) =>
        `Default working directory: ${String(params.workdir || "").trim()}`,
      "tools.script.concise.lineRelativeBase": (params = {}) =>
        `Relative paths are resolved from: ${String(params.workdir || "").trim()}`,
      "tools.script.concise.linePaths": (params = {}) =>
        `Use only paths under ${String(params.root || "").trim()} (or relative paths).`,
      "tools.script.concise.lineExtraRoots": (params = {}) =>
        `Extra mounted roots: ${String(params.roots || "").trim()}`,
      "tools.script.commonUserInstallHint":
        '- For persistent software install, prefer user-space methods: npm --prefix "$HOME/.npm-global", pip install --user, or put binaries in $HOME/bin',
      "tools.script.docker.reuse":
        "- Container is auto-created on first run and reused later (not removed), so installed software can accumulate",
      "tools.script.docker.scope.global": "one shared container for all users (default)",
      "tools.script.docker.scope.user": "one container per user",
      "tools.script.docker.title": "Docker notes:",
      "tools.script.docker.mounts.title": "- Extra mounts:",
      "tools.script.docker.mounts.none": "- No extra mounts configured.",
      "tools.script.docker.mounts.item": (params = {}) =>
        `  - ${String(params.source || "").trim()} -> ${String(params.target || "").trim()}${String(params.description || "").trim() ? ` (${String(params.description || "").trim()})` : ""}`,
      "tools.script.localModePathHint":
        "Use relative paths under this directory for input/output files.",
      "tools.script.localModeTitle": "Execute script (local mode).",
      "tools.script.localModeWorkspacePrefix": "Command runs in local directory: ",
      "tools.script.workspaceSandboxTitlePrefix": "Execute script (workspace sandbox, provider=",
      "tools.script.workspaceSandboxTitleSuffix": ").",
      "tools.script.workdir.commonPathHint":
        "Use relative paths under this directory or paths under /workspace for input/output files.",
      "tools.script.workdir.docker.global.line1":
        "- Default working directory: /workspace/<userId>/runtime/ops_workdir",
      "tools.script.workdir.docker.user.line1":
        "- Default working directory: /workspace/runtime/ops_workdir",
    },
  },
  execute_native_script: {
    description: {
      key: "tools.nativeScript.description",
      text: "Run a Node.js function body with injected Playwright, LibreOffice, FFmpeg/FFprobe, and file capabilities for web processing, document conversion, and media normalization. output:// artifacts return as attachments; task-local values and output names cannot cross calls or serve as workspace paths. Pass only complete attachment identities to later tools.",
    },
    params: {
      script_body: {
        key: "tools.nativeScript.fieldScriptBody",
        text: "Async function body. Available bindings: browser, libreoffice, ffmpeg, ffprobe, files, output, args, and log(message). Exact signatures: await ffmpeg.run({ args: [...] }); await ffprobe.run({ args: [...] }); await libreoffice.convert({ input, outputDirectory, outputFormat }). First obtain input:// tokens with await files.input(index). Create tokens with const file = await output.file(...), const tempFile = await output.tempFile(...), or const tempDirectory = await output.tempDirectory(...). LibreOffice input may be an existing input://, output://, or temp:// file from this task; outputDirectory accepts output.directory or an awaited temp:// directory token. browser.newPage() returns a restricted page supporting goto, setContent, title, url, content, DOM operations, screenshot, and close; evaluate is unavailable. files.readText/readJson read all three token kinds; files.writeText/writeJson write output:// and temp:// file tokens. Only output:// files are returned as formal attachments. Script return values are not file outputs.",
      },
      inputs: {
        key: "tools.nativeScript.fieldInputs",
        text: "Read-only inputs. source is a logical workspace path or a complete attachment identity. files.input(index) is only the Native Script execution token; never pass output:// or temp:// across tool calls.",
      },
      filePath: {
        key: "tools.nativeScript.fieldFilePath",
        text: "When source is a string, it is a logical workspace or authorized host file path.",
      },
      attachmentIdentity: {
        key: "tools.nativeScript.fieldAttachmentIdentity",
        text: "An attachment object must contain the complete attachmentId, sessionId, and attachmentSource identity.",
      },
      arguments: {
        key: "tools.nativeScript.fieldArguments",
        text: "Structured non-secret values exposed as args.",
      },
    },
  },
};
