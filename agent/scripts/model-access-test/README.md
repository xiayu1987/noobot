# Noobot 模型访问测试 / Model access lab

在仓库根目录启动 / Start from the repository root:

```bash
npm run test:model-access
```

打开终端打印的本地地址。默认读取 `service/config/global.config.json`、`workspace/config-params.json`、`workspace/admin/config.json` 和 `workspace/admin/config-params.json`，通过现有配置模板机制解析参数及环境变量。只列出有效且已启用的模型。配置文件修改后重启测试程序。

Open the local URL printed in the terminal. The app loads the files above using Noobot’s existing configuration templates and environment lookup, listing valid enabled models. Restart the app after changing configuration files.

```bash
npm run test:model-access -- --user admin --port 8765
npm run test:model-access -- --config /path/to/global.config.json --workspace /path/to/workspace
```

默认绑定 `127.0.0.1`，使用系统分配的空闲端口。不需要构建前端或启动聊天服务；如果模型地址指向本地 model-proxy，需要该代理保持运行。远程服务器可用 SSH 端口转发访问，例如固定端口启动后执行 `ssh -L 8765:127.0.0.1:8765 user@server`。

The server binds to `127.0.0.1` on an available port. No frontend build or chat service is needed. If your model endpoint points to model-proxy, that proxy must be running. For a remote machine, use SSH port forwarding, for example `ssh -L 8765:127.0.0.1:8765 user@server` after starting with the fixed port above.

## 使用 / Usage

1. 选择配置模型，确认模型名和 Base URL。可临时修改地址、模型名和密钥，空白密钥表示沿用配置。OpenAI-compatible 模型可以切换 Responses / Chat Completions；Anthropic 模型沿用其现有适配器。
2. 修改测试消息，点击“从 Noobot 生成请求”。这一步通过真实运行时与 SDK 生成发送体，但不访问上游。
3. 参数勾选表示发送，取消表示完全删除。值按 JSON 编辑，支持对象、数组、布尔值及自定义参数。嵌套参数在对应对象中修改。可查看“待发送请求体”。修改连接或消息后需重新生成。
4. 点击“发送测试”，查看 HTTP 状态、耗时、模型输出、原始响应及脱敏后的实际请求。`stream` 可以编辑，流式响应在完成后展示。一次测试最多向上游发送一次请求，120 秒超时，也可手动停止。
5. “导入日志 / JSON”支持 model-proxy 日志的第一条请求、请求体 JSON 或导出的测试结果。导入不发送请求，也不导入日志里的鉴权头；检查所选配置与接口后再发送。“最小请求”保留 `model`、`input` / `messages` 及已存在的 `max_tokens`；“恢复生成值”恢复最近一次生成或导入的完整请求。
6. 测试记录在当前页面保留最近 8 条，编号累计增长。可导出当前结果。所有修改仅针对本次测试，不写回配置文件。结果导出包含消息和响应正文，请按需要保管。

7. Select a configured model and verify its name and Base URL. Temporary endpoint, model name and key overrides are supported; a blank key uses the configured credential. OpenAI-compatible models support Responses / Chat Completions; Anthropic models use their existing adapter.
8. Edit messages and select **Generate with Noobot**. This runs the real runtime and SDK request construction without accessing the upstream endpoint.
9. Check fields to send them; uncheck to remove them completely. Edit JSON values, including nested objects and arrays, or add custom parameters. Inspect the outgoing body. Connection or message changes require regeneration.
10. Select **Send test** to see HTTP status, elapsed time, normalized output, raw response and the redacted actual request. Streaming responses are shown after completion. Each test sends at most one upstream request, with a 120-second deadline and manual cancellation.
11. Import the first request from a model-proxy log, a request JSON object, or an exported result. Importing does not send a request or reuse logged authorization headers. Verify the selected model and API before sending. **Minimal request** keeps `model`, `input` / `messages`, and an existing `max_tokens`; **Restore generated** restores the latest generated or imported body.
12. The page keeps the latest 8 tests, with a continuously increasing counter. Export the selected result as needed. Changes do not update configuration files. Exports include message and response content.

## 实现与验证 / Implementation and checks

### 工具绑定 / Tool binding

“工具绑定”可以选择“绑定工具”或“不绑定工具”。绑定模式提供可编辑的工具定义 JSON 数组和 `auto / required / none` 策略，点击“从 Noobot 生成请求”后，工具通过现有 `bindTools` / 供应商适配器转换。内置 `diagnostic_echo` 示例，也可粘贴工具定义，或导入日志中的实际工具列表。工具返回的调用名称和参数会显示在模型输出中，测试程序不会执行这些调用。

生成或导入请求后，切换“不绑定工具”会移除 `tools`、`tool_choice`、`parallel_tool_calls`，保留消息和其他参数；切回绑定模式会恢复保留的工具字段。修改工具定义或策略后需要重新生成请求。参数区仍可单独取消工具相关字段。

Select **Bind tools** or **Without tools**. Bound mode accepts an editable JSON array and an `auto / required / none` policy. **Generate with Noobot** routes these through the existing tool-binding adapter. Start with the `diagnostic_echo` example, paste definitions, or import actual tools from a proxy log. Returned tool names and arguments appear in model output; no tool is executed.

After generating or importing a request, switching to **Without tools** removes `tools`, `tool_choice`, and `parallel_tool_calls` while retaining messages and other parameters. Switching back restores retained tool fields. Regenerate after editing definitions or the policy. Individual tool fields can still be omitted in the parameter editor.

复用 `noobot-agent/model`、配置模板解析、`createModelRequestExecutor`、适配器注册表和 SDK。通过可注入的 fetch 在适配完成后的发送边界替换最终 JSON，因此取消的字段不会再被运行时默认值补回。测试界面只编辑请求数据，不执行模型返回的工具调用。

The app reuses `noobot-agent/model`, configuration template resolution, `createModelRequestExecutor`, the adapter registry and SDKs. An injectable fetch replaces the final JSON at the transport boundary, so omitted fields cannot be reintroduced by defaults. Returned tool calls are displayed without execution.

```bash
node --test model-runtime/__tests__/*.test.js agent/__tests__/model-access/server.test.js
npm run check:quality
```

`requests-2026-09-28-001.log` 中的请求为 `/v1/responses`，HTTP 400，返回 `Upstream request failed`，上游未标明具体参数。本次开发验证中，同一模型配置的精简请求和默认参数的短消息请求均返回 HTTP 200 / `OK`；这不能证明原始工具或上下文请求已修复，可使用日志导入继续逐项对比。

The reported `requests-2026-09-28-001.log` contains a `/v1/responses` request returning HTTP 400 with `Upstream request failed`, without a specific parameter error. During validation, the same configured model returned HTTP 200 / `OK` for both a reduced request and a short message using generated defaults. This does not establish that the original tool/context request is fixed; import it to compare parameters.
