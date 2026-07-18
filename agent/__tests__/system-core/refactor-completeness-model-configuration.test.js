/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDefaultModelSpec,
  resolveModelSpecByAlias,
  resolveModelSpecByName,
  resolveSkillModelSpec
} from '../../src/system-core/model/resolver/index.js';
import {
  pickAlias,
  getProviders,
  getEnabledProviders,
  firstEnabledAlias
} from '../../src/system-core/model/provider/resolver.js';

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
