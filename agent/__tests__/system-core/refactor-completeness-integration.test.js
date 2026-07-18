/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMessageEntity,
  normalizeTaskEntity
} from '../../src/system-core/session/entities.js';
import {
  resolveDefaultModelSpec,
  resolveSkillModelSpec
} from '../../src/system-core/model/resolver/index.js';

const mockWorkspaceService = {
  getWorkspacePath: async (sessionId) => `/workspace/${sessionId}`
};
const { ContextBuilder } = await import('../../src/system-core/bot-manage/session/context-builder.js');

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
