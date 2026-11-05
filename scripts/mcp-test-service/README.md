# MCP test service

Independent Streamable HTTP MCP server using the official MCP SDK. The `echo` tool returns its required `text` argument unchanged. Invalid arguments produce MCP tool errors. No Noobot runtime code is imported by the server.

```sh
npm run install:mcp-test-service
npm --prefix scripts/mcp-test-service test
npm --prefix scripts/mcp-test-service start
```

The integration test uses Noobot's production MCP client to verify initialization, discovery, calls and argument errors. It is included in `npm test`.

`npm run e2e:docker -- test full` starts this service in a separate container on the E2E network before starting Noobot. `down` stops both containers. The shared `noobot-e2e-network` is created when absent and persists across shutdowns and restarts so external dependencies, such as MySQL, retain their connections. `config.mjs` defines the service name, address and generated MCP configuration. The Docker workspace preparation replaces global and user MCP configuration with this test service; host production configuration is unchanged. `/health` reports readiness; stdout records MCP request methods, IDs and parameters for auditing.

PBE-051 verifies child-session interaction authority and passes the submitted verification code through the actual MCP `echo` tool. It uses `gpt_6_1_sol` like the rest of the suite.

E2E restarts refresh configuration without erasing runtime sessions. Failed and targeted run sessions remain available until the final successful full suite and system API cleanup. Preserve evidence outside `test-results/e2e-evidence` before successful full-suite cleanup, which removes that failure archive.
