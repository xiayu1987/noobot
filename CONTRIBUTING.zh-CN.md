# 贡献指南

中文 | [English](./CONTRIBUTING.md)

感谢你为 Noobot 做出贡献 🎉

## 提交流程

1. Fork 仓库并创建分支：
   - `feat/...`
   - `fix/...`
   - `docs/...`
2. 安装依赖、验证并在本地运行：
   ```bash
   npm ci
   npm run install:mcp-test-service
   npm run check:quality
   npm test
   npm run build
   ./start.sh
   ```
3. 提交 PR，说明：
   - 变更动机
   - 影响范围
   - 验证方式

## 性能测试

Node.js 性能测量和负载测试统一在用例名称中标记 `@performance`。
GitHub Actions 通过 `NODE_OPTIONS=--test-skip-pattern=@performance` 排除这些用例，嵌套 npm 脚本同样生效。
功能测试、性能门禁算法的确定性测试继续执行。
本地 `npm test` 保留性能测试；性能验收在资源可控的环境执行。
本地复现 GitHub 的选择范围：`NODE_OPTIONS=--test-skip-pattern=@performance npm test`。

## 代码建议

`npm run check:quality` 包含[僵尸代码检查](./docs/dead-code-quality.md)。
可单独运行 `npm run check:dead-code`，检查未使用的生产文件、导出和依赖。

Node.js 和 npm 版本以根目录 `package.json` 为准。
[CI 工作流](./.github/workflows/quality-checks.yml) 在 Node.js 24.21.0 和 26.9.0 上执行
质量检查、仓库回归和客户端构建。浏览器协议测试需单独针对已启动的服务运行，见
[E2E 运行说明](./client/noobot-chat/tests/e2e/protocol/README.md)。

- 改动保持“小且聚焦”。
- 不提交运行时/构建产物（遵循 `.gitignore`）。
- 如涉及配置或环境变量变更，请同步更新：
  - 文档
  - 示例文件（`*.example.*`）

## 文档维护

从[文档索引](./docs/README.md)进入。使用和架构说明随代码更新，已有翻译的文档同步维护中英文。
字段结构引用协议定义，验收条件引用可执行 spec。任务清单、临时审核、按日期记录的测量结果和
实施进度不放入长期说明文档；工作跟踪使用 issue 和 PR，旧文档通过 Git 历史查询。
保留发布记录和许可证声明。

## Commit Message（建议）

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`
- `chore: ...`

## 提交 PR 前检查

- [ ] 质量检查通过
- [ ] 全仓测试通过
- [ ] 生产客户端构建通过
- [ ] 涉及运行行为时项目可正常启动
- [ ] 相关文档已更新
- [ ] 未提交敏感信息
