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
   npm install
   npm run check:quality
   npm test
   ./start.sh
   ```
3. 提交 PR，说明：
   - 变更动机
   - 影响范围
   - 验证方式

## 代码建议

- 改动保持“小且聚焦”。
- 不提交运行时/构建产物（遵循 `.gitignore`）。
- 如涉及配置或环境变量变更，请同步更新：
  - 文档
  - 示例文件（`*.example.*`）

## Commit Message（建议）

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`
- `chore: ...`

## 提交 PR 前检查

- [ ] 质量检查通过
- [ ] 全仓测试通过
- [ ] 涉及运行行为时项目可正常启动
- [ ] 相关文档已更新
- [ ] 未提交敏感信息
