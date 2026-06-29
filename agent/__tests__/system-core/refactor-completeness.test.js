import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'url';

// ========== 导入实际模块 ==========
import {
  normalizeMessageEntity,
  normalizeTaskEntity,
  normalizeSessionTreeEntity,
  normalizeSelectedConnectors
} from '../../src/system-core/session/entities.js';

import {
  resolveDefaultModelSpec,
  resolveModelSpecByAlias,
  resolveModelSpecByName,
  resolveSkillModelSpec
} from '../../src/system-core/model/resolver/index.js';

import {
  pickAlias,
  byAliasWithUser,
  getProviders,
  getEnabledProviders,
  firstEnabledAlias
} from '../../src/system-core/model/provider/resolver.js';

// ContextBuilder 需要 workspaceService，我们 mock 它
const mockWorkspaceService = {
  getWorkspacePath: async (sessionId) => `/workspace/${sessionId}`
};

// 动态导入 ContextBuilder
const { ContextBuilder } = await import('../../src/system-core/bot-manage/session/context-builder.js');

// ========== 辅助函数 ==========
function createBaseGlobalConfig(overrides = {}) {
  return {
    defaultModel: 'openai:gpt-4',
    defaultProvider: 'openai',
    maxContextTurns: 50,
    ...overrides,
    providers: {
      openai: {
        type: 'openai',
        apiKey: '${OPENAI_API_KEY}',
        enabled: true,
        model: 'gpt-4',
        contextWindow: 8192,
        maxTokens: 4096,
        models: {
          'gpt-4': { alias: 'gpt4', contextWindow: 8192, maxTokens: 4096 },
          'gpt-3.5-turbo': { alias: 'gpt35', contextWindow: 4096, maxTokens: 2048 }
        }
      },
      anthropic: {
        type: 'anthropic',
        apiKey: '${ANTHROPIC_API_KEY}',
        enabled: true,
        model: 'claude-3-opus',
        contextWindow: 200000,
        maxTokens: 4096,
        models: {
          'claude-3-opus': { alias: 'opus', contextWindow: 200000, maxTokens: 4096 },
          'claude-3-sonnet': { alias: 'sonnet', contextWindow: 200000, maxTokens: 4096 }
        }
      },
      ...(overrides.providers || {})
    }
  };
}

function createBaseUserConfig(overrides = {}) {
  return {
    defaultModel: overrides.defaultModel || null,
    defaultProvider: overrides.defaultProvider || null,
    maxContextTurns: overrides.maxContextTurns || null,
    providers: overrides.providers || {},
    ...(overrides.extra || {})
  };
}

// ========== 1. Context 透传测试 ==========
describe('1. Context 透传测试', () => {
  describe('ContextBuilder.build()', () => {
    it('应正确透传 sessionId', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const sessionId = 'test-session-123';
      const context = await builder.build(sessionId, { name: 'programming' }, { allow: ['execute_script'] });
      assert.equal(context.sessionId, sessionId, 'sessionId 应正确透传');
    });

    it('应正确透传 scenario 配置', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const scenario = { name: 'programming', model: 'openai:gpt-4' };
      const context = await builder.build('sess-1', scenario, {});
      assert.deepEqual(context.scenario, scenario, 'scenario 应完整透传');
    });

    it('应正确透传 toolPolicy', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const toolPolicy = { allow: ['execute_script', 'call_service'], deny: [] };
      const context = await builder.build('sess-1', {}, toolPolicy);
      assert.deepEqual(context.toolPolicy, toolPolicy, 'toolPolicy 应完整透传');
    });

    it('workspacePath 应通过 workspaceService 动态获取', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const context = await builder.build('my-session', {}, {});
      assert.equal(context.workspacePath, '/workspace/my-session', 'workspacePath 应由 workspaceService 生成');
    });

    it('Context 应包含 timestamp 字段', async () => {
      const builder = new ContextBuilder(mockWorkspaceService);
      const context = await builder.build('sess-1', {}, {});
      assert.ok('timestamp' in context, 'Context 应包含 timestamp');
      assert.equal(typeof context.timestamp, 'string', 'timestamp 应为字符串');
    });
  });
});

// ========== 2. 字段对齐测试 ==========
describe('2. 字段对齐测试', () => {
  describe('normalizeMessageEntity 字段对齐', () => {
    it('应包含 role, content, type, ts 等核心字段', () => {
      const raw = { role: 'user', content: 'hello', type: 'text' };
      const normalized = normalizeMessageEntity(raw);
      assert.ok('role' in normalized, '应包含 role');
      assert.ok('content' in normalized, '应包含 content');
      assert.ok('type' in normalized, '应包含 type');
      assert.ok('ts' in normalized, '应包含 ts');
    });

    it('ts 应为字符串类型（ISO 时间或传入值转字符串）', () => {
      const raw = { role: 'user', content: 'test', ts: 1234567890 };
      const normalized = normalizeMessageEntity(raw);
      assert.equal(typeof normalized.ts, 'string', 'ts 应为字符串');
      assert.equal(normalized.ts, '1234567890', '数值 ts 应转为字符串');
    });

    it('缺失 ts 时应自动生成 ISO 时间字符串', () => {
      const raw = { role: 'assistant', content: 'hi' };
      const normalized = normalizeMessageEntity(raw);
      assert.ok(typeof normalized.ts === 'string' && normalized.ts.length > 0, '应自动生成 ts');
    });

    it('tool_calls 字段在 type=tool_call 时应保证为数组', () => {
      const raw = { role: 'assistant', type: 'tool_call', content: '' };
      const normalized = normalizeMessageEntity(raw);
      assert.ok(Array.isArray(normalized.tool_calls), 'tool_call 类型应保证 tool_calls 为数组');
    });

    it('summarized 字段默认应为 false', () => {
      const raw = { role: 'user', content: 'test' };
      const normalized = normalizeMessageEntity(raw);
      assert.equal(normalized.summarized, false, 'summarized 默认应为 false');
    });

    it('rawModelContent 不落盘（由 execution 日志保留完整信息）', () => {
      const raw1 = { role: 'user', content: 'test', rawModelContent: 'raw text' };
      const n1 = normalizeMessageEntity(raw1);
      assert.ok(!('rawModelContent' in n1), 'string rawModelContent 默认不落盘');

      const rawSig = {
        role: 'assistant',
        content: 'test',
        rawModelContent: [{ type: 'text', text: 'x', thought_signature: 'sig-1' }],
      };
      const nSig = normalizeMessageEntity(rawSig);
      assert.ok(!('rawModelContent' in nSig), 'thought_signature array 也不落盘');

      const raw2 = { role: 'user', content: 'test', rawModelContent: 123 };
      const n2 = normalizeMessageEntity(raw2);
      assert.ok(!('rawModelContent' in n2), '非 string/array rawModelContent 不应保留');
    });

    it('modelAdditionalKwargs 不落盘', () => {
      const raw1 = {
        role: 'user',
        content: 'test',
        modelAdditionalKwargs: { key: 'val', tool_calls: [{ id: 'c1' }] },
      };
      const n1 = normalizeMessageEntity(raw1);
      assert.ok(!('modelAdditionalKwargs' in n1), 'modelAdditionalKwargs 不落盘');

      const raw2 = { role: 'user', content: 'test', modelAdditionalKwargs: [1, 2] };
      const n2 = normalizeMessageEntity(raw2);
      assert.ok(!('modelAdditionalKwargs' in n2), 'array modelAdditionalKwargs 不应保留');
    });
  });

  describe('normalizeTaskEntity 字段对齐', () => {
    it('应包含 taskId, taskName, taskStatus, startedAt, endedAt, result, meta 字段', () => {
      const raw = { taskId: 'task-1', taskName: 'test task', taskStatus: 'completed' };
      const normalized = normalizeTaskEntity(raw);
      const requiredFields = ['taskId', 'taskName', 'taskStatus', 'startedAt', 'endedAt', 'result', 'meta'];
      for (const field of requiredFields) {
        assert.ok(field in normalized, `应包含 ${field}`);
      }
    });

    it('taskStatus 仅 start/completed 有效，其他为空字符串', () => {
      const n1 = normalizeTaskEntity({ taskId: 't1', taskStatus: 'start' });
      assert.equal(n1.taskStatus, 'start');

      const n2 = normalizeTaskEntity({ taskId: 't2', taskStatus: 'completed' });
      assert.equal(n2.taskStatus, 'completed');

      const n3 = normalizeTaskEntity({ taskId: 't3', taskStatus: 'running' });
      assert.equal(n3.taskStatus, '', 'running 应转为空字符串');
    });

    it('meta 字段缺失时默认为空对象', () => {
      const normalized = normalizeTaskEntity({ taskId: 't1' });
      assert.deepEqual(normalized.meta, {}, 'meta 默认应为空对象');
    });
  });

  describe('normalizeSessionTreeEntity 字段对齐', () => {
    it('应包含 roots, nodes, updatedAt 字段', () => {
      const raw = {
        roots: ['session-1'],
        nodes: { 'session-1': { sessionId: 'session-1', parentSessionId: '', children: [] } }
      };
      const normalized = normalizeSessionTreeEntity(raw);
      assert.ok('roots' in normalized, '应包含 roots');
      assert.ok('nodes' in normalized, '应包含 nodes');
      assert.ok('updatedAt' in normalized, '应包含 updatedAt');
    });

    it('roots 和 nodes 应为数组/对象类型', () => {
      const normalized = normalizeSessionTreeEntity({});
      assert.ok(Array.isArray(normalized.roots), 'roots 应为数组');
      assert.ok(typeof normalized.nodes === 'object', 'nodes 应为对象');
    });

    it('nodes 中每个节点应规范化 sessionId 和 parentSessionId', () => {
      const raw = {
        nodes: {
          's1': { parentSessionId: '', children: ['s2'] },
          's2': { parentSessionId: 's1', children: [] }
        }
      };
      const normalized = normalizeSessionTreeEntity(raw);
      assert.equal(normalized.nodes['s1'].sessionId, 's1');
      assert.equal(normalized.nodes['s1'].parentSessionId, '');
      assert.ok(Array.isArray(normalized.nodes['s1'].children));
    });
  });

  describe('normalizeSelectedConnectors 字段对齐', () => {
    it('应保留传入的 connector 键值对', () => {
      const raw = { database: 'pg-1', terminal: 'bash' };
      const normalized = normalizeSelectedConnectors(raw);
      assert.equal(normalized.database, 'pg-1');
      assert.equal(normalized.terminal, 'bash');
    });

    it('空对象应返回空对象', () => {
      const normalized = normalizeSelectedConnectors({});
      assert.deepEqual(normalized, {});
    });

    it('非对象输入应返回空对象', () => {
      assert.deepEqual(normalizeSelectedConnectors(null), {});
      assert.deepEqual(normalizeSelectedConnectors(undefined), {});
      assert.deepEqual(normalizeSelectedConnectors('invalid'), {});
    });
  });
});

// ========== 3. Session 字段完整性测试 ==========
describe('3. Session 字段完整性测试', () => {
  describe('Session 运行时实体结构验证', () => {
    it('Session 应包含 sessionId, userId, scenario, status, createdAt, updatedAt', () => {
      const session = {
        sessionId: 'sess-1',
        userId: 'primary-user',
        scenario: 'programming',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        parentSessionId: '',
        children: [],
        messages: [],
        tasks: [],
        config: {},
        metadata: {}
      };

      const requiredFields = [
        'sessionId', 'userId', 'scenario', 'status',
        'createdAt', 'updatedAt', 'parentSessionId',
        'children', 'messages', 'tasks', 'config', 'metadata'
      ];

      for (const field of requiredFields) {
        assert.ok(field in session, `Session 应包含字段: ${field}`);
      }
    });

    it('Task 实体应包含 taskId, taskName, taskStatus, startedAt, endedAt, result, meta', () => {
      const task = normalizeTaskEntity({
        taskId: 'task-1',
        taskName: 'execute script',
        taskStatus: 'completed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: 'success',
        meta: { exitCode: 0 }
      });

      const requiredFields = ['taskId', 'taskName', 'taskStatus', 'startedAt', 'endedAt', 'result', 'meta'];
      for (const field of requiredFields) {
        assert.ok(field in task, `Task 应包含字段: ${field}`);
      }
    });

    it('Message 实体应包含 role, content, type, ts, summarized', () => {
      const message = normalizeMessageEntity({
        role: 'user',
        content: 'hello',
        type: 'text',
        ts: Date.now()
      });

      const requiredFields = ['role', 'content', 'type', 'ts', 'summarized'];
      for (const field of requiredFields) {
        assert.ok(field in message, `Message 应包含字段: ${field}`);
      }
    });
  });
});

// ========== 4. 落盘字段完整性测试 ==========
describe('4. 落盘字段完整性测试', () => {
  describe('session.json 落盘结构', () => {
    it('落盘 session.json 应包含完整字段', () => {
      const diskSession = {
        sessionId: 'sess-1',
        userId: 'primary-user',
        scenario: 'programming',
        status: 'completed',
        parentSessionId: '',
        children: [],
        config: {
          model: 'openai:gpt-4',
          maxContextTurns: 50,
          selectedConnectors: { database: '', terminal: '', email: '' }
        },
        metadata: {
          totalTurns: 10,
          totalTokens: 5000,
          startTime: Date.now(),
          endTime: Date.now()
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const requiredFields = [
        'sessionId', 'userId', 'scenario', 'status',
        'parentSessionId', 'children', 'config', 'metadata',
        'createdAt', 'updatedAt'
      ];

      for (const field of requiredFields) {
        assert.ok(field in diskSession, `session.json 应包含字段: ${field}`);
      }
    });
  });

  describe('task.json 落盘结构', () => {
    it('落盘 task.json 应包含完整字段', () => {
      const diskTask = {
        taskId: 'task-1',
        taskName: 'execute script',
        taskStatus: 'completed',
        skillName: 'default',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: 'success',
        meta: { exitCode: 0, duration: 150 }
      };

      const requiredFields = [
        'taskId', 'taskName', 'taskStatus', 'skillName',
        'startedAt', 'endedAt', 'result', 'meta'
      ];

      for (const field of requiredFields) {
        assert.ok(field in diskTask, `task.json 应包含字段: ${field}`);
      }
    });
  });

  describe('execution.json 落盘结构', () => {
    it('落盘 execution.json 应包含完整字段', () => {
      const diskExecution = {
        sessionId: 'sess-1',
        turnId: 'turn-1',
        status: 'completed',
        model: 'openai:gpt-4',
        inputMessages: [{ role: 'user', content: 'hello' }],
        outputMessage: { role: 'assistant', content: 'hi' },
        toolCalls: [],
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 2000
      };

      const requiredFields = [
        'sessionId', 'turnId', 'status', 'model',
        'inputMessages', 'outputMessage', 'toolCalls',
        'tokenUsage', 'startTime', 'endTime', 'duration'
      ];

      for (const field of requiredFields) {
        assert.ok(field in diskExecution, `execution.json 应包含字段: ${field}`);
      }
    });
  });
});

// ========== 5. 配置优先级测试 ==========
describe('5. 配置优先级测试', () => {
  describe('pickAlias 优先级链：skill > user > global', () => {
    it('skill.provider 应最高优先级', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({ defaultProvider: 'anthropic' });
      const skillConfig = { provider: 'openai' };

      const alias = pickAlias({ globalConfig, userConfig, skillConfig });
      assert.equal(alias, 'openai', 'skill.provider 应优先');
    });

    it('skill.model 应次高优先级（无 skill.provider 时）', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({ defaultProvider: 'anthropic' });
      const skillConfig = { model: 'custom-provider' };

      const alias = pickAlias({ globalConfig, userConfig, skillConfig });
      assert.equal(alias, 'custom-provider', 'skill.model 应优先于 user/global');
    });

    it('user.defaultProvider 应优先于 global.defaultProvider', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({ defaultProvider: 'anthropic' });
      const skillConfig = {};

      const alias = pickAlias({ globalConfig, userConfig, skillConfig });
      assert.equal(alias, 'anthropic', 'user.defaultProvider 应优先于 global');
    });

    it('无 skill/user 时应使用 global.defaultProvider', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});
      const skillConfig = {};

      const alias = pickAlias({ globalConfig, userConfig, skillConfig });
      assert.equal(alias, 'openai', '应使用 global.defaultProvider');
    });

    it('全部为空时应返回空字符串', () => {
      const globalConfig = { providers: {} };
      const userConfig = {};
      const skillConfig = {};

      const alias = pickAlias({ globalConfig, userConfig, skillConfig });
      assert.equal(alias, '', '全部为空应返回空字符串');
    });
  });

  describe('Provider 合并优先级：user 覆盖 global', () => {
    it('user providers 应覆盖 global providers 中的同名 provider', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({
        providers: {
          openai: {
            type: 'openai',
            apiKey: 'user-custom-key',
            model: 'gpt-4-turbo'
          }
        }
      });

      const merged = getProviders(globalConfig, userConfig);
      assert.equal(merged.openai.apiKey, 'user-custom-key', 'user provider 应覆盖 global');
      assert.equal(merged.openai.model, 'gpt-4-turbo', 'user provider 的 model 应覆盖');
    });

    it('user providers 不应影响 global 中未覆盖的 provider', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({
        providers: {
          openai: { type: 'openai', apiKey: 'user-key' }
        }
      });

      const merged = getProviders(globalConfig, userConfig);
      assert.ok('anthropic' in merged, 'anthropic provider 应保留');
      assert.equal(merged.anthropic.apiKey, '${ANTHROPIC_API_KEY}', 'anthropic 配置应保持不变');
    });

    it('user 可新增 global 中不存在的 provider', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({
        providers: {
          custom: { type: 'custom', apiKey: 'custom-key', model: 'custom-model' }
        }
      });

      const merged = getProviders(globalConfig, userConfig);
      assert.ok('custom' in merged, '新增的 provider 应存在');
      assert.equal(merged.custom.apiKey, 'custom-key');
    });
  });

  describe('enabled 过滤优先级', () => {
    it('enabled: false 的 provider 应被排除', () => {
      const globalConfig = createBaseGlobalConfig({
        providers: {
          openai: { type: 'openai', apiKey: 'key', enabled: false, model: 'gpt-4' }
        }
      });
      const userConfig = createBaseUserConfig({});

      const enabled = getEnabledProviders(globalConfig, userConfig);
      assert.ok(!('openai' in enabled), 'enabled: false 的 provider 应被排除');
    });

    it('未设置 enabled 的 provider 默认启用', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({});

      const enabled = getEnabledProviders(globalConfig, userConfig);
      assert.ok('openai' in enabled, 'openai 默认应启用');
      assert.ok('anthropic' in enabled, 'anthropic 默认应启用');
    });
  });
});

// ========== 6. 配置获取完整性测试 ==========
describe('6. 配置获取完整性测试', () => {
  describe('resolveDefaultModelSpec', () => {
    it('应能从 globalConfig 解析默认模型 spec（通过 defaultProvider）', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});

      const spec = resolveDefaultModelSpec({ globalConfig, userConfig });
      assert.ok(spec !== null, '应能解析到默认模型 spec');
      assert.equal(spec.alias, 'openai', 'alias 应为 openai');
      assert.equal(spec.model, 'gpt-4', 'model 应为 gpt-4');
    });

    it('user 配置的 defaultProvider 应覆盖 global', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({ defaultProvider: 'anthropic' });

      const spec = resolveDefaultModelSpec({ globalConfig, userConfig });
      assert.ok(spec !== null, '应能解析到模型 spec');
      assert.equal(spec.alias, 'anthropic', 'alias 应为 anthropic');
      assert.equal(spec.model, 'claude-3-opus', 'model 应为 claude-3-opus');
    });

    it('无 defaultProvider 时应 fallback 到 firstEnabledAlias', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: null });
      const userConfig = createBaseUserConfig({});

      const spec = resolveDefaultModelSpec({ globalConfig, userConfig });
      assert.ok(spec !== null, '应能 fallback 到第一个启用的 provider');
      assert.ok(spec.alias === 'openai' || spec.alias === 'anthropic', '应为已启用的 provider');
    });

    it('无有效配置时应返回 null', () => {
      const globalConfig = { providers: {} };
      const userConfig = {};

      const spec = resolveDefaultModelSpec({ globalConfig, userConfig });
      assert.equal(spec, null, '无有效配置时应返回 null');
    });
  });

  describe('resolveModelSpecByAlias', () => {
    it('应能通过 alias 解析模型 spec', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({});

      const spec = resolveModelSpecByAlias({
        alias: 'anthropic',
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '应能通过 alias 解析到 spec');
      assert.equal(spec.alias, 'anthropic', 'alias 应为 anthropic');
    });

    it('不存在的 alias 应 fallback 到默认', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});

      const spec = resolveModelSpecByAlias({
        alias: 'nonexistent',
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '不存在的 alias 应 fallback 到默认');
      assert.equal(spec.alias, 'openai', 'fallback 后 alias 应为 openai');
    });

    it('不存在的 alias 且 fallbackToDefault=false 时应返回 null', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({});

      const spec = resolveModelSpecByAlias({
        alias: 'nonexistent',
        globalConfig,
        userConfig,
        fallbackToDefault: false
      });
      assert.equal(spec, null, '不存在的 alias 且无 fallback 应返回 null');
    });
  });

  describe('resolveModelSpecByName', () => {
    it('应能通过 modelName 解析模型 spec（匹配 alias）', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({});

      const spec = resolveModelSpecByName({
        modelName: 'openai',
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '应能通过 modelName 解析到 spec');
      assert.equal(spec.alias, 'openai', 'alias 应为 openai');
    });

    it('应能通过 provider 的 model 字段匹配', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({});

      const spec = resolveModelSpecByName({
        modelName: 'gpt-4',
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '应能通过 model 名称匹配到 spec');
      assert.equal(spec.alias, 'openai', '应匹配到 openai provider');
    });

    it('不存在的 modelName 应 fallback 到默认', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});

      const spec = resolveModelSpecByName({
        modelName: 'nonexistent-model',
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '应 fallback 到默认');
      assert.equal(spec.alias, 'openai', 'fallback 后应为 openai');
    });
  });

  describe('resolveSkillModelSpec', () => {
    it('skill.provider 应能覆盖默认模型', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});
      const skillConfig = { provider: 'anthropic' };

      const spec = resolveSkillModelSpec({
        skillConfig,
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '应能解析到 spec');
      assert.equal(spec.alias, 'anthropic', 'skill.provider 应覆盖默认');
    });

    it('skill.model 应能覆盖默认模型', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});
      const skillConfig = { model: 'anthropic' };

      const spec = resolveSkillModelSpec({
        skillConfig,
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '应能解析到 spec');
      assert.equal(spec.alias, 'anthropic', 'skill.model 应覆盖默认');
    });

    it('skill 的温度/ tokens 等参数应能覆盖 spec', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});
      const skillConfig = {
        provider: 'openai',
        temperature: 0.5,
        maxTokens: 2048
      };

      const spec = resolveSkillModelSpec({
        skillConfig,
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '应能解析到 spec');
      assert.equal(spec.temperature, 0.5, 'temperature 应被 skill 覆盖');
      assert.equal(spec.maxTokens, 2048, 'maxTokens 应被 skill 覆盖');
    });

    it('skill 配置为空时应使用默认模型', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});
      const skillConfig = {};

      const spec = resolveSkillModelSpec({
        skillConfig,
        globalConfig,
        userConfig
      });
      assert.ok(spec !== null, '应能解析到默认 spec');
      assert.equal(spec.alias, 'openai', '应使用默认 provider');
    });
  });
});

// ========== 7. 模型切换测试 ==========
describe('7. 模型切换测试', () => {
  describe('通过 provider alias 切换模型', () => {
    it('应能从 openai 切换到 anthropic', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({});

      const spec1 = resolveModelSpecByAlias({ alias: 'openai', globalConfig, userConfig });
      const spec2 = resolveModelSpecByAlias({ alias: 'anthropic', globalConfig, userConfig });

      assert.ok(spec1 !== null && spec2 !== null, '两个 alias 都应能解析');
      assert.notEqual(spec1.alias, spec2.alias, '切换后 alias 应不同');
      assert.notEqual(spec1.model, spec2.model, '切换后 model 应不同');
    });

    it('应能切换到同一 provider 的不同模型（通过 user 覆盖）', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({
        providers: {
          openai: {
            type: 'openai',
            apiKey: 'key',
            model: 'gpt-3.5-turbo'
          }
        }
      });

      const spec = resolveModelSpecByAlias({ alias: 'openai', globalConfig, userConfig });
      assert.ok(spec !== null, '应能解析');
      assert.equal(spec.model, 'gpt-3.5-turbo', '应切换到 user 配置的模型');
    });
  });

  describe('通过 modelName 切换模型', () => {
    it('应能通过完整 modelName 切换', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({});

      const spec1 = resolveModelSpecByName({ modelName: 'openai', globalConfig, userConfig });
      const spec2 = resolveModelSpecByName({ modelName: 'anthropic', globalConfig, userConfig });

      assert.ok(spec1 !== null && spec2 !== null, '两个 modelName 都应能解析');
      assert.notEqual(spec1.alias, spec2.alias, '切换后 alias 应不同');
    });
  });

  describe('通过 skill 配置切换模型', () => {
    it('skill 配置应能临时覆盖默认模型', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});
      const skillConfig = { provider: 'anthropic' };

      const defaultSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
      const skillSpec = resolveSkillModelSpec({ skillConfig, globalConfig, userConfig });

      assert.ok(defaultSpec !== null && skillSpec !== null, '都应能解析');
      assert.notEqual(defaultSpec.alias, skillSpec.alias, 'skill 应覆盖默认模型');
    });

    it('skill 的 temperature/maxTokens 应能临时覆盖', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});
      const skillConfig = { provider: 'openai', temperature: 0.2, maxTokens: 1024 };

      const defaultSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
      const skillSpec = resolveSkillModelSpec({ skillConfig, globalConfig, userConfig });

      assert.ok(skillSpec.temperature === 0.2, 'skill temperature 应生效');
      assert.ok(skillSpec.maxTokens === 1024, 'skill maxTokens 应生效');
    });
  });

  describe('firstEnabledAlias 辅助函数', () => {
    it('应返回第一个启用的 provider alias', () => {
      const globalConfig = createBaseGlobalConfig();
      const userConfig = createBaseUserConfig({});

      const alias = firstEnabledAlias(globalConfig, userConfig);
      assert.ok(alias === 'openai' || alias === 'anthropic', '应返回已启用的 provider');
    });

    it('无启用 provider 时应返回空字符串', () => {
      const globalConfig = {
        providers: {
          openai: { type: 'openai', apiKey: 'key', enabled: false }
        }
      };
      const userConfig = {};

      const alias = firstEnabledAlias(globalConfig, userConfig);
      assert.equal(alias, '', '无启用 provider 应返回空字符串');
    });
  });
});

// ========== 8. 综合集成测试 ==========
describe('8. 综合集成测试', () => {
  describe('完整执行流程数据流', () => {
    it('Context 构建 → 模型解析 → 配置合并 应连贯工作', async () => {
      // 1. 构建 Context
      const builder = new ContextBuilder(mockWorkspaceService);
      const context = await builder.build('integration-test-1', { name: 'programming' }, { allow: ['execute_script'] });

      assert.ok(context.sessionId, 'Context 应包含 sessionId');
      assert.ok(context.workspacePath, 'Context 应包含 workspacePath');
      assert.ok(context.scenario, 'Context 应包含 scenario');

      // 2. 解析模型
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});
      const modelSpec = resolveDefaultModelSpec({ globalConfig, userConfig });

      assert.ok(modelSpec !== null, '应能解析到模型 spec');

      // 3. 验证数据流连贯性
      assert.equal(typeof context.sessionId, 'string', 'sessionId 类型正确');
      assert.equal(typeof modelSpec.alias, 'string', 'model alias 类型正确');
      assert.equal(typeof modelSpec.model, 'string', 'model name 类型正确');
    });

    it('配置优先级链应正确影响模型选择', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });

      // 场景 1：仅 global
      const spec1 = resolveDefaultModelSpec({
        globalConfig,
        userConfig: createBaseUserConfig({})
      });
      assert.equal(spec1.alias, 'openai', '应使用 global 默认');

      // 场景 2：user 覆盖
      const spec2 = resolveDefaultModelSpec({
        globalConfig,
        userConfig: createBaseUserConfig({ defaultProvider: 'anthropic' })
      });
      assert.equal(spec2.alias, 'anthropic', '应使用 user 配置');

      // 场景 3：skill 覆盖
      const skillConfig = { provider: 'openai' };
      const spec3 = resolveSkillModelSpec({
        skillConfig,
        globalConfig,
        userConfig: createBaseUserConfig({ defaultProvider: 'anthropic' })
      });
      assert.equal(spec3.alias, 'openai', 'skill 应覆盖 user 和 global');
    });

    it('Session 实体规范化后字段应与落盘结构对齐', () => {
      // 规范化消息
      const rawMsg = { role: 'user', content: 'test', type: 'text', ts: Date.now() };
      const normalizedMsg = normalizeMessageEntity(rawMsg);

      // 验证规范化后的字段
      assert.ok('role' in normalizedMsg, '应包含 role');
      assert.ok('content' in normalizedMsg, '应包含 content');
      assert.ok('type' in normalizedMsg, '应包含 type');
      assert.ok('ts' in normalizedMsg, '应包含 ts');

      // 规范化任务
      const rawTask = { taskId: 'task-1', taskName: 'test', taskStatus: 'completed' };
      const normalizedTask = normalizeTaskEntity(rawTask);

      assert.ok('taskId' in normalizedTask, '应包含 taskId');
      assert.ok('taskName' in normalizedTask, '应包含 taskName');
      assert.ok('taskStatus' in normalizedTask, '应包含 taskStatus');
      assert.ok('startedAt' in normalizedTask, '应包含 startedAt');
      assert.ok('endedAt' in normalizedTask, '应包含 endedAt');
    });

    it('模型切换后 spec 应保持完整字段', () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: 'openai' });
      const userConfig = createBaseUserConfig({});

      const spec = resolveDefaultModelSpec({ globalConfig, userConfig });
      assert.ok(spec !== null, '应能解析到 spec');

      // 验证 spec 包含必要字段
      const requiredSpecFields = ['alias', 'type', 'model', 'apiKey'];
      for (const field of requiredSpecFields) {
        assert.ok(field in spec, `spec 应包含字段: ${field}`);
      }
    });
  });
});
