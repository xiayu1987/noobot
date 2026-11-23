# 文档索引 / Documentation

这里收录随代码维护的使用和架构说明。字段结构、版本和校验规则以协议实现为准，
测试验收条件以可执行 spec 为准。过期任务、临时审核和历史测量通过 Git 历史查询。

This index links maintained usage and architecture guides. Protocol implementations
define schemas and validation; executable specs define acceptance conditions.
Superseded task records, audits, and measurements are available in Git history.

## 使用与开发 / Usage and development

- 项目入口 / Project: [中文](../README.zh-CN.md) · [English](../README.md)
- 配置 / Configuration: [中文](../CONFIGURATION.zh-CN.md) · [English](../CONFIGURATION.md)
- 贡献 / Contributing: [中文](../CONTRIBUTING.zh-CN.md) · [English](../CONTRIBUTING.md)
- [编码规范 / Coding standard](../CODING-STANDARD.md)
- [系统运行参数 / Runtime parameters](runtime-parameters.md)
- [僵尸代码质量检查 / Dead-code quality](dead-code-quality.md)
- [有效未完成项汇总 / Open items](open-items.md)

## 架构与协议 / Architecture and protocols

- [消息身份 / Message identity](message-identity.md)
- [模型上下文消息规则 / Model context messages](model-context-message-rules.md)
- [供应商适配与缓存 / Provider adaptation and cache](model-provider-adaptation-cache.md)
- [图片与视频生成 / Image and video generation](model-generation.md)
- [工具名称绑定 / Tool name binding](tool-name-binding.md)
- [附件事实源 / Attachment ownership](attachment-fact-source-architecture.md)
- [语义传递场景 / Semantic transfer scenarios](semantic-transfer-scenario-inventory.md)
- [插件策略 / Plugin policy](plugin-policy-contract.md)
- [会话协议 / Session protocol](../session-protocol/README.md)
- [上下文协议 / Context protocol](../context-protocol/README.md)
- [插件协议 / Plugin protocol](../plugin-protocol/README.md)
- [工作区协议 / Workspace protocol](../workspace-protocol/README.md)
- [会话存储架构 / Session storage architecture](session-storage-architecture.md)
- [前端架构 / Frontend architecture](../client/noobot-chat/src/README.md)

## 测试 / Testing

- [浏览器协议 E2E 运行 / Browser protocol E2E](../client/noobot-chat/tests/e2e/protocol/README.md)
- [浏览器场景索引 / Browser scenario index](../client/noobot-chat/tests/e2e/protocol/specs/README.md)
- [模型访问测试 / Model access tester](../agent/scripts/model-access-test/README.md)
