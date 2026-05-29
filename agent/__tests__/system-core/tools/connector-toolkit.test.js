import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { createConnectorTools } from "../../../src/system-core/tools/connectors/connector-toolkit.js";

function parseToolJson(raw = "") {
  return JSON.parse(String(raw || "{}"));
}

function buildAccessConnectorRuntime({
  basePath = "",
  connectorType = "database",
  connectorName = "main",
  onExecute = () => {},
  globalConfig = {},
} = {}) {
  const type = String(connectorType || "").trim();
  const name = String(connectorName || "").trim() || "main";
  const connected = {
    connectorName: name,
    connectorType: type,
    connectedAt: new Date().toISOString(),
  };
  const empty = [];
  const connectors = {
    databases: type === "database" ? [connected] : empty,
    terminals: type === "terminal" ? [connected] : empty,
    emails: type === "email" ? [connected] : empty,
  };
  return {
    basePath,
    systemRuntime: {
      sessionId: "s-child",
      rootSessionId: "s-root",
      config: {
        selectedConnectors: {
          [type]: name,
        },
      },
    },
    sharedTools: {
      connectorChannelStore: {
        getSessionConnectors() {
          return connectors;
        },
        async executeConnectorCommand(payload = {}) {
          onExecute(payload);
          return {
            ok: true,
            connector: connected,
            output: {
              code: 0,
              stdout: "ok",
              stderr: "",
            },
          };
        },
      },
      connectorEventListener: {
        onConnectorAccessed() {},
      },
    },
    globalConfig,
    userConfig: {},
  };
}

test("connector-toolkit/inspect_connectors: 应返回连接器汇总", async () => {
  const runtime = {
    systemRuntime: {
      sessionId: "s-child",
      rootSessionId: "s-root",
      config: {},
    },
    sharedTools: {
      connectorChannelStore: {
        async inspectSessionConnectors() {
          return {
            connectors: {
              databases: [{ connector_name: "db-main" }],
              terminals: [{ connector_name: "ssh-main" }],
              emails: [{ connector_name: "mail-main" }],
            },
            summary: { total_count: 3 },
          };
        },
        getSessionConnectors() {
          return {
            databases: [{ connector_name: "db-main" }],
            terminals: [{ connector_name: "ssh-main" }],
            emails: [{ connector_name: "mail-main" }],
          };
        },
      },
      connectorEventListener: {
        syncRuntimeConnectorChannels() {},
      },
    },
    globalConfig: {},
    userConfig: {},
  };

  const tools = createConnectorTools({
    agentContext: { runtime },
  });
  const inspectTool = tools.find((tool) => tool?.name === "inspect_connectors");
  assert.ok(inspectTool, "inspect_connectors 工具应存在");

  const payload = parseToolJson(await inspectTool.invoke({}));
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "completed");
  assert.equal(payload.summary?.total_count, 3);
  assert.equal(payload.summary?.database_count, 1);
  assert.equal(payload.summary?.terminal_count, 1);
  assert.equal(payload.summary?.email_count, 1);
});

test("connector-toolkit/database_connect_connector: 交互补全应携带 pending/manual 语义字段", async () => {
  const interactionCalls = [];
  const runtime = {
    systemRuntime: {
      sessionId: "s-child",
      rootSessionId: "s-root",
      dialogProcessId: "dp-1",
      config: { allowUserInteraction: true },
    },
    userInteractionBridge: {
      async requestUserInteraction(payload = {}) {
        interactionCalls.push(payload);
        return {
          host: "127.0.0.1",
          port: 3306,
          username: "u1",
          password: "p1",
          database: "db1",
        };
      },
    },
    sharedTools: {
      connectorChannelStore: {
        connectConnector({ sessionId, connectorName, connectorType, connectionInfo }) {
          return {
            sessionId,
            connectorName,
            connectorType,
            connectionInfo,
          };
        },
        inspectConnectorRuntimeStatus() {
          return {
            status: "connected",
            status_code: 0,
            status_message: "ok",
            checked_at: "2026-05-17T00:00:00.000Z",
          };
        },
        getSessionConnectors() {
          return {
            databases: [],
            terminals: [],
            emails: [],
          };
        },
      },
      connectorEventListener: {
        async onConnectorConnected() {},
        onConnectorAlreadyConnected() {},
        syncRuntimeConnectorChannels() {},
      },
    },
    globalConfig: {},
    userConfig: {},
  };

  const tools = createConnectorTools({
    agentContext: { runtime },
  });
  const connectTool = tools.find((tool) => tool?.name === "database_connect_connector");
  assert.ok(connectTool, "database_connect_connector 工具应存在");

  const payload = parseToolJson(
    await connectTool.invoke({
      connector_name: "db-main",
      database_type: "mysql",
      default_values: {},
    }),
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.status, "connected");
  assert.equal(interactionCalls.length, 1);
  assert.equal(String(interactionCalls[0]?.lifecycle || ""), "pending");
  assert.equal(String(interactionCalls[0]?.ackMode || ""), "manual");
  assert.equal(String(interactionCalls[0]?.resolvedBy || ""), "");
});

test("connector-toolkit/access_connector: command_file_path 应可读取文件内容并执行", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-access-file-"));
  try {
    const sqlPath = path.join(tmpRoot, "queries", "demo.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(sqlPath, "select 1 from dual where 1=1;", "utf8");
    let executed = null;
    const runtime = buildAccessConnectorRuntime({
      basePath: tmpRoot,
      connectorType: "database",
      connectorName: "db-main",
      onExecute: (payload) => {
        executed = payload;
      },
    });
    const tools = createConnectorTools({ agentContext: { runtime } });
    const accessTool = tools.find((tool) => tool?.name === "access_connector");
    assert.ok(accessTool, "access_connector 工具应存在");

    const result = parseToolJson(await accessTool.invoke({
      connector_type: "database",
      command_file_path: "queries/demo.sql",
    }));
    assert.equal(result.ok, true);
    assert.equal(String(executed?.command || ""), "select 1 from dual where 1=1;");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("connector-toolkit/access_connector: command 与 command_file_path 同时传入应拒绝", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-access-file-"));
  try {
    const sqlPath = path.join(tmpRoot, "queries", "demo.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(sqlPath, "select 1 where 1=1;", "utf8");
    const runtime = buildAccessConnectorRuntime({
      basePath: tmpRoot,
      connectorType: "database",
      connectorName: "db-main",
    });
    const tools = createConnectorTools({ agentContext: { runtime } });
    const accessTool = tools.find((tool) => tool?.name === "access_connector");
    assert.ok(accessTool, "access_connector 工具应存在");

    await assert.rejects(
      accessTool.invoke({
        connector_type: "database",
        command: "select 1 where 1=1;",
        command_file_path: "queries/demo.sql",
      }),
      (error) => error?.code === "RECOVERABLE_INVALID_INPUT",
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("connector-toolkit/access_connector: command_file_path 越界应拒绝", async () => {
  const allowedRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-access-allowed-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-access-outside-"));
  try {
    const outsideSqlPath = path.join(outsideRoot, "danger.sql");
    await writeFile(outsideSqlPath, "select 1 where 1=1;", "utf8");
    const runtime = buildAccessConnectorRuntime({
      basePath: allowedRoot,
      connectorType: "database",
      connectorName: "db-main",
      globalConfig: {
        tools: {
          access_connector: {
            enabled: true,
            command_file: {
              enabled: true,
              allowed_roots: [allowedRoot],
            },
          },
        },
      },
    });
    const tools = createConnectorTools({ agentContext: { runtime } });
    const accessTool = tools.find((tool) => tool?.name === "access_connector");
    assert.ok(accessTool, "access_connector 工具应存在");

    await assert.rejects(
      accessTool.invoke({
        connector_type: "database",
        command_file_path: outsideSqlPath,
      }),
      (error) => error?.code === "RECOVERABLE_PATH_OUT_OF_SCOPE",
    );
  } finally {
    await rm(allowedRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("connector-toolkit/access_connector: command_file_path 后缀不在白名单应拒绝", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-access-file-"));
  try {
    const txtPath = path.join(tmpRoot, "queries", "demo.txt");
    await mkdir(path.dirname(txtPath), { recursive: true });
    await writeFile(txtPath, "select 1 where 1=1;", "utf8");
    const runtime = buildAccessConnectorRuntime({
      basePath: tmpRoot,
      connectorType: "database",
      connectorName: "db-main",
      globalConfig: {
        tools: {
          access_connector: {
            enabled: true,
            command_file: {
              enabled: true,
              allowed_extensions: [".sql"],
            },
          },
        },
      },
    });
    const tools = createConnectorTools({ agentContext: { runtime } });
    const accessTool = tools.find((tool) => tool?.name === "access_connector");
    assert.ok(accessTool, "access_connector 工具应存在");

    await assert.rejects(
      accessTool.invoke({
        connector_type: "database",
        command_file_path: "queries/demo.txt",
      }),
      (error) => error?.code === "RECOVERABLE_INVALID_INPUT",
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("connector-toolkit/access_connector: command_file_path 超过大小限制应拒绝", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-access-file-"));
  try {
    const sqlPath = path.join(tmpRoot, "queries", "big.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(sqlPath, "x".repeat(4096), "utf8");
    const runtime = buildAccessConnectorRuntime({
      basePath: tmpRoot,
      connectorType: "database",
      connectorName: "db-main",
      globalConfig: {
        tools: {
          access_connector: {
            enabled: true,
            command_file: {
              enabled: true,
              max_bytes: 128,
            },
          },
        },
      },
    });
    const tools = createConnectorTools({ agentContext: { runtime } });
    const accessTool = tools.find((tool) => tool?.name === "access_connector");
    assert.ok(accessTool, "access_connector 工具应存在");

    await assert.rejects(
      accessTool.invoke({
        connector_type: "database",
        command_file_path: "queries/big.sql",
      }),
      (error) =>
        error?.code === "RECOVERABLE_ATTACHMENT_FILE_SIZE_LIMIT_EXCEEDED",
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
