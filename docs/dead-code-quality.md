# Dead-code quality check / 僵尸代码质量检查

## Usage / 使用

```bash
npm run check:dead-code
npm run check:quality
```

EN: `check:dead-code` is a step of the existing quality runner and therefore runs in the existing CI quality job. It uses Knip to measure unreachable production files, unused exports (including namespace exports), and unused declared dependencies. ESLint continues to own unused imports, local bindings and unreachable statements; the existing unused-parameter check owns parameter usage.

中文：`check:dead-code` 已加入既有质量执行器，随现有 CI 质量任务运行。它使用 Knip 测量不可达的生产文件、无引用导出（含命名空间导出）和未使用的声明依赖。未使用 import、局部绑定、不可达语句仍由 ESLint 检查，参数使用情况仍由既有参数检查负责。

## Scope and entries / 范围与入口

EN: Project files come directly from `getFirstPartyCodeFiles`, using the repository workspace declarations and shared source inventory. Tests participate in reference analysis, but findings in tests, generated sources, dependencies, vendor files and runtime data do not count toward production measurements. Package exports remain public entry points. A symbol used only by tests is considered referenced; this check does not prove production execution or runtime coverage.

中文：项目文件直接来自 `getFirstPartyCodeFiles`，复用仓库工作区声明和统一源码清单。测试参与引用分析，但测试、生成代码、依赖目录、第三方文件和运行时数据中的告警不计入生产指标。包的公开导出保留为公开入口。仅由测试引用的符号视为有引用；本检查不能证明生产执行情况或运行时覆盖率。

EN: Additional entry facts are derived from plugin `manifest.json` entries and contributed component modules, and desktop `package.json#build.afterPack`. Verified non-import entries are declared in `scripts/quality/dead-code-config.mjs`; their existence is checked so removed entries cannot silently remain configured.

中文：额外入口事实来自插件 `manifest.json` 的入口及贡献组件模块，以及桌面端 `package.json#build.afterPack`。经核实的非 import 入口声明在 `scripts/quality/dead-code-config.mjs`，并检查文件存在性，避免入口删除后配置静默残留。

| Entry / 入口                                                                                                   | Consumer / 调用来源                                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `scripts/lib/runtime-topology-cli.mjs`, `scripts/wait-runtime-ready.mjs`, `scripts/validate-pm2-processes.mjs` | Runtime shell scripts / 运行时 Shell 脚本                                 |
| `scripts/e2e-docker/prepare-workspace.mjs`                                                                     | `scripts/e2e-docker/run.sh`                                               |
| `scripts/migrate-attachment-record-v1.mjs`                                                                     | `attachment-protocol/README.md`                                           |
| `scripts/generate-character-animation-demo.mjs`, `scripts/capture-character-animation-runtime.mjs`             | Character plugin README / 角色插件说明                                    |
| `scripts/remove-source-comments.mjs`                                                                           | Source-comment quality remediation command / 源码注释检查修复命令         |
| `scripts/analyze-log-duplicates.mjs`                                                                           | Standalone CLI with built-in usage / 自带用法说明的独立 CLI               |
| `service/scripts/project-launcher.js`                                                                          | `scripts/project-launcher.mjs` starts a child process / 启动子进程        |
| `agent/scripts/model-access-test/public/app.js`                                                                | Model access lab HTML / 模型访问实验页                                    |
| `client/shared/electron/preload.cjs`                                                                           | Electron window preload and runtime packaging / Electron 窗口预加载与打包 |

## Baseline and exemptions / 基线与豁免

EN: The check uses the existing `defineCheck`, measurements, exemption usage tracking and baseline evaluator. Increases fail. Decreases also fail until the baseline is lowered. Exemptions need a reason and a scoped match; stale exemptions fail. No automatic baseline update command is provided.

中文：检查复用既有 `defineCheck`、测量结果、豁免使用追踪和基线评估器。指标增加失败；指标下降后必须收紧基线，否则也失败。豁免必须说明理由并限定匹配范围，失效豁免会失败。不提供自动更新基线的命令。

| Initial measurement (2026-10-31) / 初始实测 | Count / 数量 |
| ------------------------------------------- | -----------: |
| `unusedFiles`                               |           16 |
| `unusedExports`                             |          122 |
| `unusedDependencies`                        |           30 |
| `exemptions`                                |            3 |

EN: The authoritative current baseline and scoped exemptions are defined in [`CHECK` in `scripts/check-dead-code.mjs`](../scripts/check-dead-code.mjs). Run `npm run check:dead-code` for current measurements. As with the existing count baselines, exchanging an old finding for a new one with the same total is not detected by the count alone.

中文：当前基线及限定范围的豁免以 [`scripts/check-dead-code.mjs` 的 `CHECK`](../scripts/check-dead-code.mjs) 为唯一事实源，实时测量运行 `npm run check:dead-code`。与现有计数基线一致，旧问题减少、新问题增加且总量不变的情况，仅靠计数不能识别。

EN: The three dependency exemptions match only `connector-instances/package.json` entries for `mysql2`, `pg` and `ssh2`. Their channel implementations pass package names to `loadDriverModule`, which dynamically imports a variable. The same names in another package are not exempted.

中文：三项依赖豁免仅匹配 `connector-instances/package.json` 中的 `mysql2`、`pg` 和 `ssh2`。对应通道把包名传入 `loadDriverModule`，后者通过变量动态导入。其他包中同名依赖不会被豁免。

EN: To inspect all raw findings, including test findings and exempted drivers, run:

中文：查看全部原始告警（包含测试文件及已豁免驱动）：

```bash
npm exec -- knip --config knip.config.mjs --reporter json --no-progress
```

EN: Knip exits nonzero when raw findings exist; `check:dead-code` evaluates the production measurements against the repository baseline. Scanner failures and malformed reports remain errors.

中文：存在原始告警时 Knip 返回非零退出码；`check:dead-code` 将生产指标与仓库基线比较。扫描器故障和无效报告仍然报错。
