/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function buildToolSchemaFlat(schemaByTool = {}) {
  const flat = {};
  for (const spec of Object.values(schemaByTool || {})) {
    const description = spec?.description && typeof spec.description === "object"
      ? spec.description
      : {};
    const descriptionKey = String(description?.key || "").trim();
    const descriptionText = description?.text;
    if (descriptionKey) flat[descriptionKey] = descriptionText;

    const params = spec?.params && typeof spec.params === "object" ? spec.params : {};
    for (const paramSpec of Object.values(params)) {
      const normalized = paramSpec && typeof paramSpec === "object" ? paramSpec : {};
      const key = String(normalized?.key || "").trim();
      if (!key) continue;
      flat[key] = normalized?.text;
    }

    const texts = spec?.texts && typeof spec.texts === "object" ? spec.texts : {};
    for (const [key, value] of Object.entries(texts)) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) continue;
      flat[normalizedKey] = value;
    }
  }
  return flat;
}

export const TOOL_SCHEMA_BY_TOOL = {
  "access_connector": {
    "description": {
      "key": "tools.access_connector.description",
      "text": "Access connector resources. Input connector_name, connector_type, and command. Returns connector execution result."
    },
    "params": {
      "command": {
        "key": "tools.access_connector.fieldCommand",
        "text": "Command content. database uses SQL; terminal uses shell; email uses JSON (action options: send|list|read|list_folders)."
      },
      "connector_name": {
        "key": "tools.access_connector.fieldConnectorName",
        "text": "Connector name."
      },
      "connector_type": {
        "key": "tools.access_connector.fieldConnectorType",
        "text": "Options: database|terminal|email. Connector type."
      }
    },
    "texts": {
      "connectors.access.alreadyConnected": "Connector is already connected. Use access_connector to execute commands.",
      "connectors.access.execCompleted": "Execution completed",
      "connectors.access.execFailed": (params = {}) =>
    `Execution failed${String(params.reason || "").trim() ? `: ${String(params.reason || "").trim()}` : ""}`,
      "connectors.access.reconnectNeeded": (params = {}) =>
    `Selected connector "${String(params.connectorName || "").trim()}" is not connected. Reconnect with connector tools before executing commands.`,
      "connectors.access.selectedConnectorNotConnected": (params = {}) =>
    `selected connector not connected: ${String(params.connectorType || "").trim()}/${String(params.connectorName || "").trim()}`,
      "connectors.access.selectedMissing": (params = {}) =>
    `No ${String(params.connectorType || "").trim()} connector is selected in current context, cannot execute access_connector`,
      "connectors.access.selectedOnly": (params = {}) =>
    `Current context only allows selected connector: ${String(params.connectorName || "").trim()}`,
      "connectors.access.statusInspectorUnavailable": "connector runtime status inspector unavailable",
      "connectors.access.fillDatabaseConnectionInfo": (params = {}) =>
    `Please provide database connection info (type: ${String(params.databaseType || "").trim() || "unknown"})`,
      "connectors.access.fillTerminalConnectionInfo": (params = {}) =>
    `Please provide terminal connection info (type: ${String(params.terminalType || "").trim() || "unknown"})`,
      "connectors.access.fillEmailConnectionInfo": "Please provide email connection info",
      "connectors.access.connectorNameLabel": "Connector name",
      "connectors.access.missingConnectionInfoNoInteraction": "Missing connection info and user interaction is disabled",
      "connectors.access.noConnectorsFound": "No connectors found",
      "connectors.access.userCancelledAction": "User cancelled connection info input",
      "connectors.commandRequired": "command required",
      "connectors.connectorNameRequired": "connectorName required",
      "connectors.connectorNotConnectedInSession": "connector not connected in current session",
      "connectors.connectorTypeInvalid": "connectorType must be database|terminal|email",
      "connectors.email.commandActionInvalid": "email command action must be send|list|read|list_folders",
      "connectors.email.commandJsonObjectRequired": "email command JSON object required",
      "connectors.email.commandJsonStringRequired": "email command must be JSON string",
      "connectors.email.commandRequired": "email command required",
      "connectors.email.notFoundByUid": "email not found by uid",
      "connectors.email.readUidRequired": "email read action requires uid, and INBOX has no readable message",
      "connectors.email.sendToRequired": "email send action requires 'to' (or configure to_email in connector)",
      "connectors.email.smtpImapHostRequired": "email connector smtp_host/imap_host required",
      "connectors.email.usernamePasswordRequired": "email connector username/password required",
      "connectors.event.connected": "connector connected",
      "connectors.event.reconnectRequired": "selected connector is not connected, please reconnect",
      "connectors.fields.database": "Database",
      "connectors.fields.emailAccount": "Email Account",
      "connectors.fields.fromAddress": "From Address",
      "connectors.fields.host": "Host",
      "connectors.fields.imapHost": "IMAP Host",
      "connectors.fields.imapPort": "IMAP Port",
      "connectors.fields.password": "Password",
      "connectors.fields.passwordOrAppPassword": "Password/App Password",
      "connectors.fields.port": "Port",
      "connectors.fields.portDefault22": "Port (default 22)",
      "connectors.fields.serverIpOrDomain": "Server IP/Domain",
      "connectors.fields.smtpHost": "SMTP Host",
      "connectors.fields.smtpPort": "SMTP Port",
      "connectors.fields.sqliteFilePath": "SQLite File Path",
      "connectors.fields.username": "Username",
      "connectors.historyUserIdRequired": "userId required",
      "connectors.rootSessionMissing": "rootSessionId missing in systemRuntime",
      "connectors.ssh.channelKeyRequired": "ssh channel key required",
      "connectors.ssh.hostUserPassRequired": "ssh host/username/password required",
      "connectors.ssh.ssh2NotInstalled": "ssh2 not installed, run: npm i ssh2",
      "connectors.statusConnectorNotFoundInInspected": "connector not found in inspected result",
      "connectors.statusOk": "ok",
      "connectors.statusInvalidConnectorIdentity": "invalid connector identity",
      "connectors.statusUnavailable": "status unavailable",
      "connectors.storeMissing": "connector channel store missing",
      "tools.access_connector.errorConnectorTypeRequired": "connector_type(database|terminal|email) required"
    }
  },
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
        "text": "Model name (optional)."
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
  "database_connect_connector": {
    "description": {
      "key": "tools.database_connector.description",
      "text": "Create and connect a database connector. Input connector_name and database_type (optional default_values). Returns connection status and connector info."
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "Connector name."
      },
      "database_type": {
        "key": "tools.database_connector.fieldDatabaseType",
        "text": "Options: mysql|postgres|sqlite. Database type."
      },
      "default_values": {
        "key": "tools.database_connector.fieldDefaultValues",
        "text": "Default connection parameters (optional, JSON string or object)."
      }
    },
    "texts": {
      "tools.database_connector.errorInvalidType": "database_type must be mysql|postgres|sqlite"
    }
  },
  "delegate_task_async": {
    "description": {
      "key": "tools.agent_collab.delegateDescription",
      "text": "Delegate multiple subtasks concurrently. Input a tasks list (each includes taskName and taskContent). Returns async task container results."
    },
    "params": {
      "tasks": {
        "key": "tools.agent_collab.fieldTasks",
        "text": "Subtask list."
      },
      "tasks[].taskContent": {
        "key": "tools.agent_collab.fieldTaskContent",
        "text": "Subtask content."
      },
      "tasks[].taskName": {
        "key": "tools.agent_collab.fieldTaskName",
        "text": "Subtask name."
      }
    },
    "texts": {
      "tools.agent_collab.childAsyncResultContainersRequired": "childAsyncResultContainers required",
      "tools.agent_collab.dialogContextHint": "delegate_task_async requires current dialog process context",
      "tools.agent_collab.humanTaskPrefix": "Task text:",
      "tools.agent_collab.noResult": "(no result)",
      "tools.agent_collab.parentSessionIdRequired": "parentSessionId required",
      "tools.agent_collab.planPrompt1": "Multi-task collaboration planning.",
      "tools.agent_collab.planPrompt2": "Please output planning content and task call chain.",
      "tools.agent_collab.planPrompt3": "Output must be JSON. Do not use markdown code blocks.",
      "tools.agent_collab.planPrompt4": "JSON format:",
      "tools.agent_collab.planPrompt5": "{ \"tasks\":[{ \"taskName\":\"task_a\", \"taskContent\":\"task goal/content\",\"subTasks\":[] }] }",
      "tools.agent_collab.runtimeDialogProcessIdMissing": "runtime dialogProcessId missing",
      "tools.agent_collab.runtimeMissingBotManagerUserId": "runtime missing bot manager/user id",
      "tools.agent_collab.runtimeSessionIdMissing": "runtime sessionId missing",
      "tools.agent_collab.sessionContextHint": "delegate_task_async requires current session context",
      "tools.agent_collab.taskNameTaskContentRequired": "taskName/taskContent required",
      "tools.agent_collab.tasksRequired": "tasks required"
    }
  },
  "doc_to_data": {
    "description": {
      "key": "tools.doc2data.description",
      "text": "Extract document content into text data. Input filePath (optional prompt, dpi, imageFormat). Returns document parsing result."
    },
    "params": {
      "dpi": {
        "key": "tools.doc2data.fieldDpi",
        "text": "DPI (optional)."
      },
      "filePath": {
        "key": "tools.doc2data.fieldFilePath",
        "text": "Document path."
      },
      "imageFormat": {
        "key": "tools.doc2data.fieldImageFormat",
        "text": "Image format (optional)."
      },
      "prompt": {
        "key": "tools.doc2data.fieldPrompt",
        "text": "Extraction prompt (optional)."
      }
    },
    "texts": {
      "doc2img.inputFileRequired": "inputFile required",
      "doc2img.noImageOutputFromPdf": "no image output generated from PDF",
      "doc2img.unsupportedFileType": "unsupported file type",
      "tools.doc2data.batchPrompt": (params = {}) =>
    `This is image batch ${Number(params.batchIndex || 1)}, page range ${String(params.range || "")}. Output in page order.`,
      "tools.doc2data.extractPrompt": "Extract all readable text from the images, keep original structure, and do not fabricate content.",
      "tools.doc2data.noImagesProduced": "no images produced"
    }
  },
  "email_connect_connector": {
    "description": {
      "key": "tools.email_connector.description",
      "text": "Create and connect an email connector. Input connector_name (optional default_values). Returns connection status and connector info."
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "Connector name."
      },
      "default_values": {
        "key": "tools.email_connector.fieldDefaultValues",
        "text": "Default connection parameters (optional, JSON string or object)."
      }
    },
    "texts": {}
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
      }
    },
    "texts": {
      "tools.script.bubblewrap.line1": "- Host root filesystem is used as lowerdir",
      "tools.script.bubblewrap.line2": "- Use runtime/sandbox/bubblewrap/overlay-upper|overlay-work under user directory as writable layer",
      "tools.script.bubblewrap.line3": "- Commands run in persistent directory /workspace/runtime/sandbox/persist, files can accumulate",
      "tools.script.bubblewrap.title": "Bubblewrap + overlayfs notes:",
      "tools.script.commandNotInstalled": (params = {}) =>
    `${String(params.commandName || "").trim()} is not installed. Please install ${String(params.commandName || "").trim()} first.`,
      "tools.script.commonUserInstallHint": "- For persistent software install, prefer user-space methods: npm --prefix \"$HOME/.npm-global\", pip install --user, or put binaries in $HOME/bin",
      "tools.script.docker.reuse": "- Container is auto-created on first run and reused later (not removed), so installed software can accumulate",
      "tools.script.docker.scope.global": "one shared container for all users (default)",
      "tools.script.docker.scope.user": "one container per user",
      "tools.script.docker.title": "Docker notes:",
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
      "tools.script.workdir.docker.global.line1": "- Default working directory: /workspace/<userId>/runtime/workspace",
      "tools.script.workdir.docker.user.line1": "- Default working directory: /workspace/runtime/workspace",
      "tools.script.workdir.firejail.line1": "- Default working directory: $HOME/runtime/sandbox/persist",
      "tools.script.workdir.firejail.line2": "Use relative paths under this directory or paths under $HOME for input/output files."
    }
  },
  "inspect_connectors": {
    "description": {
      "key": "tools.inspect_connectors.description",
      "text": "Inspect connectors in current session. No input parameters. Returns masked connector list."
    },
    "params": {},
    "texts": {}
  },
  "list_skills": {
    "description": {
      "key": "tools.skill.listDescription",
      "text": "List skill directory structure. Input parentSkill (optional). Returns directory hierarchy items."
    },
    "params": {
      "parentSkill": {
        "key": "tools.skill.fieldParentSkill",
        "text": "Skill subpath (optional)."
      }
    },
    "texts": {}
  },
  "multimodal_generate": {
    "description": {
      "key": "tools.multimodal.description",
      "text": "Generate images from multimodal prompt. Input generation_content (optional model_name, image_size). Returns generated image results."
    },
    "params": {
      "generation_content": {
        "key": "tools.multimodal.fieldGenerationContent",
        "text": "Generation content description."
      },
      "image_size": {
        "key": "tools.multimodal.fieldImageSize",
        "text": "Image size (optional)."
      },
      "model_name": {
        "key": "tools.multimodal.fieldModelName",
        "text": "Model name (optional)."
      }
    },
    "texts": {
      "tools.multimodal.fetchGeneratedImageUrlFailed": "fetch generated image url failed",
      "tools.multimodal.generateFailed": "multimodal generate failed",
      "tools.multimodal.generationContentRequired": "generation_content required",
      "tools.multimodal.imagesApiNotEnabledError": "Current account does not have image generation enabled (403 Images API is not enabled).",
      "tools.multimodal.imagesApiNotEnabledMessage": "Enable Images API on your platform, or switch to a model/key with image generation enabled.",
      "tools.multimodal.modelApiKeyMissing": "model api key missing",
      "tools.multimodal.multimodalUnsupportedError": (params = {}) =>
    `Current model does not support multimodal image generation: ${String(params.model || "").trim()}`,
      "tools.multimodal.multimodalUnsupportedMessage": "Switch to a model that supports image generation, or specify one via model_name."
    }
  },
  "plan_multi_task_collaboration": {
    "description": {
      "key": "tools.agent_collab.planDescription",
      "text": "Plan multi-task collaboration. Input task. Returns decomposed collaboration plan result."
    },
    "params": {
      "task": {
        "key": "tools.agent_collab.fieldPlanTask",
        "text": "Task description."
      }
    },
    "texts": {}
  },
  "process_connector_tool": {
    "description": {
      "key": "tools.process_connector.description",
      "text": "Orchestrate connector tools to complete a task. Input task (optional modelName). Returns connector processing result."
    },
    "params": {
      "modelName": {
        "key": "tools.process_connector.fieldModelName",
        "text": "Model name (optional)."
      },
      "task": {
        "key": "tools.process_connector.fieldTask",
        "text": "Task description."
      }
    },
    "texts": {
      "tools.connectors.errorUserInteractionBridgeMissing": "user interaction bridge missing for connection info completion",
      "tools.process_connector.errorToolsUnavailable": "connector tools unavailable"
    }
  },
  "process_content_task": {
    "description": {
      "key": "tools.content_process.description",
      "text": "Orchestrate content tools to complete a task. Input task (optional modelName). Returns content processing result."
    },
    "params": {
      "modelName": {
        "key": "tools.content_process.fieldModelName",
        "text": "Model name (optional)."
      },
      "task": {
        "key": "tools.content_process.fieldTask",
        "text": "Task description."
      }
    },
    "texts": {
      "tools.content_process.dynamicDescDisabled": "Content processing tool: no sub-tools are enabled currently.",
      "tools.content_process.dynamicDescEnabledPrefix": "Content processing tool: currently enabled sub-tools: ",
      "tools.content_process.dynamicDescEnabledSuffix": ". The sub-session can only call the enabled tools above.",
      "tools.content_process.errorToolsUnavailable": "content process tools not available",
      "tools.content_process.toolDescDoc": "Parse document content (extract text from office/pdf/images)",
      "tools.content_process.toolDescGeneric": "Generic content processing",
      "tools.content_process.toolDescWeb": "Parse webpage content (URL or URL list file)"
    }
  },
  "read_file": {
    "description": {
      "key": "tools.file.readDescription",
      "text": "Read text file content. Input filePath. Returns file text result."
    },
    "params": {
      "filePath": {
        "key": "tools.file.readFilePathField",
        "text": "File path."
      }
    },
    "texts": {}
  },
  "set_skill_task": {
    "description": {
      "key": "tools.skill.setDescription",
      "text": "Set skill task status. Input action, taskId, taskName, and skillName (optional result). Returns status update result."
    },
    "params": {
      "action": {
        "key": "tools.skill.fieldAction",
        "text": "Options: start|completed. Task action."
      },
      "result": {
        "key": "tools.skill.fieldResult",
        "text": "Task result (optional)."
      },
      "skillName": {
        "key": "tools.skill.fieldSkillName",
        "text": "Skill name."
      },
      "taskId": {
        "key": "tools.skill.fieldTaskId",
        "text": "Task ID."
      },
      "taskName": {
        "key": "tools.skill.fieldTaskName",
        "text": "Task name."
      }
    },
    "texts": {
      "tools.skill.skillNameRequiredOnStart": "skillName is required when action=start"
    }
  },
  "switch_model": {
    "description": {
      "key": "tools.model.description",
      "text": "Switch the current session model. Input modelName. Returns model switch result."
    },
    "params": {
      "modelName": {
        "key": "tools.model.fieldModelName",
        "text": "Model name."
      }
    },
    "texts": {
      "model.enabledProviderModelNotFound": "enabled provider/model not found",
      "tools.model.switchApplied": "Model switched and will take effect in subsequent calls of this turn"
    }
  },
  "terminal_connect_connector": {
    "description": {
      "key": "tools.terminal_connector.description",
      "text": "Create and connect a terminal connector. Input connector_name and terminal_type (optional default_values). Returns connection status and connector info."
    },
    "params": {
      "connector_name": {
        "key": "tools.connectors.fieldConnectorName",
        "text": "Connector name."
      },
      "default_values": {
        "key": "tools.terminal_connector.fieldDefaultValues",
        "text": "Default connection parameters (optional, JSON string or object)."
      },
      "terminal_type": {
        "key": "tools.terminal_connector.fieldTerminalType",
        "text": "Options: ssh. Terminal type."
      }
    },
    "texts": {
      "tools.terminal_connector.errorInvalidType": "terminal_type currently only supports ssh"
    }
  },
  "user_interaction": {
    "description": {
      "key": "tools.user_interaction.description",
      "text": "Request user interaction to collect input. Input content and fields. Returns user-submitted result."
    },
    "params": {
      "content": {
        "key": "tools.user_interaction.fieldContent",
        "text": "Interaction content."
      },
      "fields": {
        "key": "tools.user_interaction.fieldFieldsPayload",
        "text": "Field definitions (object or JSON string)."
      }
    },
    "texts": {
      "tools.user_interaction.bridgeMissing": "user interaction bridge missing",
      "tools.user_interaction.cancelled": "cancelled",
      "tools.user_interaction.contentRequired": "interaction content/content required",
      "tools.user_interaction.fieldDescription": "Field description",
      "tools.user_interaction.fieldDisplayName": "Field display name",
      "tools.user_interaction.fieldFields": "Field definition list",
      "tools.user_interaction.fieldName": "Field name (key in returned object)",
      "tools.user_interaction.fieldRequired": "Whether required",
      "tools.user_interaction.invalidFieldsPayload": (params = {}) =>
    `invalid fields payload: ${String(params.reason || "").trim()}`,
      "tools.user_interaction.invalidResponseObject": "invalid interaction response object",
      "tools.user_interaction.missingRequiredField": (params = {}) =>
    `missing required field: ${String(params.key || "").trim()}`,
      "tools.user_interaction.sensitiveFieldsBlocked": "Sensitive fields detected. For database or terminal access, use process_connector_tool connectors."
    }
  },
  "wait": {
    "description": {
      "key": "tools.wait.description",
      "text": "Wait synchronously for a duration. Input waitMs. Returns wait completion result."
    },
    "params": {
      "waitMs": {
        "key": "tools.wait.fieldWaitMs",
        "text": "Wait duration in milliseconds."
      }
    },
    "texts": {}
  },
  "wait_async_task_result": {
    "description": {
      "key": "tools.agent_collab.waitDescription",
      "text": "Wait for async subtask result aggregation. Input timeoutMs and pollIntervalMs (optional). Returns subtask execution results."
    },
    "params": {
      "pollIntervalMs": {
        "key": "tools.agent_collab.fieldPollIntervalMs",
        "text": "Polling interval in milliseconds (optional)."
      },
      "timeoutMs": {
        "key": "tools.agent_collab.fieldTimeoutMs",
        "text": "Timeout in milliseconds (optional)."
      }
    },
    "texts": {}
  },
  "web_to_data": {
    "description": {
      "key": "tools.web2data.description",
      "text": "Parse webpages and extract content. Input input or urls (optional prompt, useTrafilatura). Returns web extraction result."
    },
    "params": {
      "input": {
        "key": "tools.web2data.fieldInput",
        "text": "Input source (URL or txt file path)."
      },
      "prompt": {
        "key": "tools.web2data.fieldPrompt",
        "text": "Extraction prompt (optional)."
      },
      "urls": {
        "key": "tools.web2data.fieldUrls",
        "text": "URL list."
      },
      "useTrafilatura": {
        "key": "tools.web2data.fieldUseTrafilatura",
        "text": "Prefer Readability extraction (optional)."
      }
    },
    "texts": {
      "tools.web2data.blockedOrUnavailable": (params = {}) =>
    `Access blocked or service unavailable (status=${Number(params.status || 0)})`,
      "tools.web2data.fetchFailedNoResult": "Web extraction failed: no usable result",
      "tools.web2data.fetchFailedWithErrors": (params = {}) =>
    `Web extraction failed: ${String(params.errors || "").trim()}`,
      "tools.web2data.noSuccessfulResult": "web_to_data no successful result",
      "tools.web2data.screenshotBatch": (params = {}) =>
    `This is batch ${Number(params.batchIndex || 1)} of webpage screenshots.\n\nWeb text reference:\n${String(params.sharedText || "")}`,
      "tools.web2data.summarizePrompt": "Based on screenshots and text, extract core webpage information: topic, key facts, data points, conclusions, and code snippets (if any), then output clearly.",
      "tools.web2data.textReference": (params = {}) =>
    `Web text reference:\n${String(params.sharedText || "")}`,
      "tools.web2data.truncated": "[Text too long, truncated]"
    }
  },
  "write_file": {
    "description": {
      "key": "tools.file.writeDescription",
      "text": "Write text content to a file. Input filePath and content. Returns write result."
    },
    "params": {
      "content": {
        "key": "tools.file.writeContentField",
        "text": "Content to write."
      },
      "filePath": {
        "key": "tools.file.writeFilePathField",
        "text": "File path."
      }
    },
    "texts": {}
  }
};

export const TOOL_SCHEMA_FLAT_GENERATED = buildToolSchemaFlat(TOOL_SCHEMA_BY_TOOL);
